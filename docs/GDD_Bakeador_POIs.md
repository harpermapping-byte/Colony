# GDD — Bakeador de mapas de POI (esqueleto, concepto capturado)

Tercer tipo de mapa del proyecto, entre el exterior total y los interiores — capturado aquí para no perder la idea, sin diseño detallado todavía (mismo estado inicial que tuvo `GDD_Bakeador_Interiores.md` antes de la sesión que lo cerró).

## 1. Los tres tipos de mapa

1. **Exterior total** (`baker/`) — el mundo completo, ya construido. Biomas, hidrología, POIs, caminos, decoración a escala de "minutos andando."
2. **Mapa de POI** (esta pieza, sin construir) — un asentamiento (aldea, ciudad, castillo, campamento...) es su propia instancia, más pequeña que el exterior total ("semi-exterior"): calles, plazas, varios edificios colocados como estructuras con su propia puerta, quizás una muralla o cerca perimetral. Se entra desde el exterior total por el POI correspondiente (mismo mecanismo `tipo: portal` que ya existe en `baker/catalogo/pois.json`), igual que hoy se entra a un interior — solo que aquí "dentro" hay otro mapa navegable, no una sola sala.
3. **Interiores** (`interiores/`) — cada edificio del mapa de POI (o un edificio suelto del exterior total, para las estructuras que no forman parte de un asentamiento) tiene su propia puerta a su propia instancia de interior, tal y como está diseñado hoy.

## 2. Por qué hace falta esta pieza intermedia

Al ampliar `interiores/catalogo/tipos_edificio.json` con edificios de pueblo (herrería, ayuntamiento, casa de gremio, biblioteca pública, museo, baños públicos, templo...) quedó claro que un POI de asentamiento del exterior total no puede seguir siendo "una puerta, un edificio" — un pueblo de verdad tiene una docena de edificios distintos a la vez, cada uno con su propia puerta. Intentar resolver eso colocando sub-estructuras directamente dentro del radio de un POI del exterior total (ampliar `baker/src/pois.js`) mezclaría dos escalas muy distintas en el mismo bakeador. Separarlo en su propio mapa intermedio es más limpio: el exterior total solo necesita saber "aquí hay un asentamiento, con esta puerta", y el mapa de POI es quien decide cuántos edificios tiene, de qué tipo, y cómo se distribuyen.

## 3. Qué reutiliza de los otros dos bakeadores

- **Escala y generación de terreno**: más cercano al exterior total que a un interior (una calle es como un camino, una plaza es como un claro) — probablemente reutiliza conceptos de `baker/src/terreno.js`/`caminos.js` a una escala mucho más pequeña, no un motor nuevo desde cero.
- **Catálogo de edificios**: cada estructura colocada en el mapa de POI es un `tipoEdificio` de `interiores/catalogo/tipos_edificio.json` — el mismo catálogo que ya existe, sin inventar uno paralelo. Colocar un edificio aquí = decidir su posición/footprint en el mapa de POI + generar su interior real con el motor de interiores (todavía sin construir tampoco) usando ese `tipoEdificio`.
- **`poiVinculado`** dejado vacío/omitido en muchos `tipoEdificio` (ver nota en `tipos_edificio.json`) es exactamente para estos — el mapa de POI decide qué `tipoEdificio` coloca dentro de sí mismo, no hace falta que cada uno tenga un id de POI del exterior total esperándolo.

## 4. FLUJO ACORDADO (2026-08-27) — ⚠️ NO programar hasta recibir las imágenes de referencia del usuario

El usuario confirmó el flujo completo pero va a adjuntar IMÁGENES de
referencia de cómo debe construirse una aldea/ciudad; se afina con ellas
delante y solo entonces se codifica.

### 4.1 Flujo de horneado (offline)

1. El exterior no cambia: su POI "asentamiento" solo dice "aquí hay una
   aldea, esta es su puerta".
2. Bakeador de aldeas (`aldeas/`, pieza nueva): semilla + tipo de
   asentamiento → mapa pequeño (~64×64–128×128 casillas) exportado EN EL
   MISMO FORMATO de sectores/chunks que el exterior. Regla de oro: el
   cliente (terreno/props/streaming) y el servidor (rejilla de colisión)
   lo consumen SIN tocar una línea — bakeador nuevo, formato viejo.
   - Terreno: motor del baker a escala reducida (plaza = claro, calles =
     caminos A*, huertos/decoración con el catálogo de exteriores).
   - Muralla: anillo de casillas sólidas propio de este bakeador, con 1-2
     casillas `portal` (la puerta al exterior).
   - Edificios: parcelas junto a las calles; cada edificio = footprint de
     casillas sólidas + su casilla `portal` (puerta al interior). El tipo
     sale de `interiores/catalogo/tipos_edificio.json` **eligiendo por
     TAGS** (decisión del usuario): la ciudad coloca edificios acordes a
     sus tags, y ese mismo tag/tipo es el que genera su interior
     instanciado — un solo vocabulario para colocar fuera y generar
     dentro.
   - **Bake anidado (decidido)**: al hornear la aldea se hornean TODOS sus
     interiores (bakeador de interiores con el `tipoEdificio` y semilla
     derivada). Un comando → aldea + N interiores, determinista y
     enlazado por datos (cada portal declara su destino en el índice).
3. **Edificios como props 3D (decidido)**: la fachada/volumen del
   edificio es un prop 3D más, como animales y objetos — convención de
   assets `edificios/<tipo>_<NN>.glb`. El bakeador coloca el PLACEHOLDER
   (caja con colorDebug y el footprint correcto) y el usuario tendrá un
   programa (análogo al taller de vóxeles de PJ/muebles) que crea los
   edificios reales y sustituye los placeholders por convención de
   nombre. Preparar aquí el SISTEMA (footprint + anclaje + convención);
   el arte llega por su lado.

### 4.2 Layout por tipo de asentamiento (decidido)

- **Aldeas**: orgánico — plaza central + caminos A* hacia las puertas +
  parcelas pegadas a calle (reutiliza conceptos de `caminos.js`).
- **Ciudades**: subdivisión BSP en manzanas (trazado urbano regular).
- **La CIUDAD PRINCIPAL es un bakeado ESPECIAL**: nace con lo mínimo
  construido y MUCHO espacio de parcelas vacías, pensadas para IR
  CONSTRUYENDO con el tiempo (enlaza con vivienda/decorador y zonas de
  GDD_Mecanicas §5.8/5.12). Apuntado; se diseña en detalle después — lo
  primero es el generador de POIs normal.

### 4.3 Flujo de juego (runtime — sincronización MMO)

Cada nivel es una room de Colyseus en el MISMO proceso único:

- `hub` = exterior (persistente, ya existe).
- `aldea:<id>` = una room por aldea, creada BAJO DEMANDA al cruzar el
  primer jugador y autodestruida al vaciarse (autoDispose) — una aldea
  vacía cuesta cero.
- `interior:<aldea>:<edificio>` = igual, con tope pequeño de jugadores.

Cruce de puerta: pisar la casilla portal + F → el SERVIDOR de la room
actual valida → responde "ve a room X, spawn en casilla Y" → el cliente
funde a negro, `leave()` + `joinOrCreate(X)` → aparece junto a la puerta
del otro lado (bidireccional, todo por datos). La sincronización sale del
propio Colyseus: quienes cruzan la misma puerta comparten room y se ven.
El mapa de la aldea lo sirve Vercel estático (pequeño, cacheado).

Free tier: mapa de colisión por room cargado al crearla (pequeño =
instantáneo) con caché LRU por si se recrea; solo el hub carga el mapa
grande; estado compartido por instancia (nodos/drops/muebles) con clave
de instancia en la persistencia (GDD_Mecanicas §5.7).

## 4.4 Referencias visuales del usuario (recibidas 2026-08-27) y reglas derivadas

El usuario aportó tres imágenes de referencia que fijan el objetivo:

1. **Dentro de la ciudad** (vista isométrica del proyecto): plaza central
   con hito (estatua/fuente) y puestos de mercado, calle principal, casas
   de entramado con tejado, y la IGLESIA como edificio destacado. Los
   PJ/NPCs se mueven por calles y plaza.
2. **Mismo estilo a escala de aldea**: una fila de casas + iglesia +
   mercadillo en la plaza — la misma lógica con menos piezas.
3. **Desde el mapa exterior**: la ciudad entera se ve como UNA miniatura
   3D amurallada (proporción algo mayor que el PJ). TODO su volumen
   bloquea el paso; solo la puerta de la muralla es interactuable y al
   acercarte entras a la instancia (vistas 1-2).

Reglas derivadas (confirmadas por el usuario):

- **La ciudad es un "cubo sin techo"**: siempre ACOTADA por su muralla
  como un interior — dentro se colocan calles, plazas y edificios; no hay
  techo. Fuera de la muralla no hay nada navegable en la instancia.
- **Tiers de asentamiento**: pequeña, mediana, grande, capital y castillo
  (castillo = más amurallado y más compacto). Cada tier define tamaño del
  recinto, nº/tags de edificios y riqueza.
- **La muralla cuenta la riqueza**: aldeas pobres = EMPALIZADA de madera;
  asentamientos ricos = muralla de PIEDRA (con torres en
  capital/castillo). Material y forma salen del tier, del catálogo.
- **Lógica de ciudad medieval al generar el interior**: plaza CENTRAL con
  hito según tier (pozo en aldea, estatua/fuente en ciudad) + puestos de
  mercado, CALLE PRINCIPAL puerta→plaza, calles secundarias a las
  parcelas, iglesia/templo con parcela destacada, resto de edificios por
  tags según tier.
- **Representación exterior = dos salidas del mismo bake**:
  (a) la ciudad como PROP 3D sobre el mapa exterior — footprint de
  casillas sólidas (todo bloquea) + casilla `portal` en la puerta; el
  `.glb` real de la miniatura lo generará el programa de edificios del
  usuario (patrón taller de vóxeles), mientras tanto placeholder de cajas
  + muralla simplificada generado del propio layout;
  (b) una vista cenital PNG del recinto (overview, como las del baker)
  para GUI/depuración/minimapa.

## 5. Preguntas aún abiertas

- ¿Cuántos edificios por asentamiento según tamaño/tipo? — cada tipo de
  asentamiento declarará su lista de tags/pesos, mismo patrón que
  `salasPorPlanta` (se concreta con las imágenes de referencia).
- ¿Decoración ambiental propia (puestos de mercado, pozos, fuentes) o
  catálogo de exteriores a escala reducida? (probablemente lo segundo +
  entradas nuevas con tags de aldea).
- Detalle del bakeado especial de la ciudad principal (parcelas,
  construcción progresiva) — pospuesto a propósito.

## 6. Estado actual

**Motor v1 CONSTRUIDO** (`ciudades/`, 2026-08-27), según el flujo de la
sección 4:

- `catalogo/asentamientos.json`: 5 tiers (aldea_pequena, aldea, pueblo,
  capital, castillo) con recinto, muralla (material/grosor/nº puertas),
  plaza y edificios (obligatorios + ponderados por id de
  `tipos_edificio.json`, patrón `salasPorPlanta`).
- `src/generar.js`: recinto "cubo sin techo" — muralla estanca con
  puertas, calle de ronda, plaza central, calle principal puerta→plaza,
  filas de parcelas con callejón-calle bajo cada fachada, y **bake
  anidado**: el interior real de cada edificio (motor de interiores) se
  genera primero y su planta baja + muros ES la huella colocada.
  `validarCiudad()`: estanqueidad (flood-fill desde fuera con puertas
  tapadas), conectividad de todas las puertas de edificio desde el spawn,
  y no-solape.
- `src/index.js` (CLI `node ciudades/src/index.js <tier> <semilla>`):
  exporta sectores + indice EN EL FORMATO DEL BAKER (crearExportador
  reutilizado; `indice.portales` y `tier` añadidos), los interiores del
  bake anidado (`interiores/*.json`), y `overview.png`. Verificado que
  `server/src/mundo/mapaColision.ts` carga una capital SIN CAMBIOS.
- Terrenos urbanos nuevos en `baker/catalogo/terrenos.json`: `adoquin`,
  `muralla_piedra`, `empalizada`, `solar_edificio` (con `uso`).
- Tests: `node --test ciudades/test/ciudad.test.js` (6).

Pendiente: layout BSP para ciudades grandes (§4.2 — hoy todos los tiers
usan el orgánico), hito de plaza y puestos de mercado (props), el prop 3D
exterior de la ciudad sobre el mapa principal (placeholder + programa del
usuario), decoración ambiental, el bakeado especial de la ciudad
principal, y el CRUCE DE PORTALES en runtime (rooms bajo demanda, §4.3).
