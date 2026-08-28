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

## 4. FLUJO ACORDADO (2026-08-27) — imágenes de referencia ya recibidas y aplicadas (§4.4)

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

### 4.2 Layout por tipo de asentamiento (decidido; ACTUALIZADO)

- **Todo el layout es ORGÁNICO** (requisito posterior del usuario, §6:
  "nada de grillas ortogonales/cuadradas rígidas") — el BSP en manzanas
  que se barajó para ciudades grandes queda descartado.
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

## 6. Motor v2 ORGÁNICO (construido 2026-08-27, requisitos del usuario)

Sustituye al v1 de rejilla: nada de grillas ortogonales — la aldea crece
adaptándose a la geografía. Pipeline (`ciudades/src/generar.js`):

1. **Terreno base**: heightmap Perlin (variante por tier: llano / colina
   central / RÍO con meandro que cruza el mapa, elegida por semilla) —
   exportado como elevación por casilla (el placeholder 2D la sombrea).
2. **Punto focal** (plaza del mercado): terreno alto y seco cerca del
   centro; disco de adoquín.
3. **Caminos principales**: A* desde los bordes del mapa al focal con
   coste por PENDIENTE y agua — bordean colinas y ríos; donde cruzan agua
   nace un PUENTE.
4. **Muralla orgánica**: polígono radial deformado con Perlin (muestreado
   sobre el círculo = periódico sin costura), TORRES en vértices (todas en
   castillo), y PUERTAS exactamente donde los caminos del paso 3 cruzan el
   anillo. **Por MÓDULOS** (`catalogo/modulos_muralla.json`: recto/curvo/
   torre/puerta, material empalizada/piedra) exportados como capa
   VECTORIAL en el índice — el programa de edificios del usuario los
   sustituirá por .glb por convención, igual que PJ/animales/árboles.
5. **Calles menores DESPUÉS de los monumentales**: los obligatorios del
   tier se asientan primero (con fallback: dando frente a la plaza, la
   iglesia presidiendo el mercado); luego crecen la calle de RONDA (anillo
   interior, solo tiers grandes/castillo) y los ramales A* estratificados
   rodeando lo construido; después se coloca el resto.
6. **Edificios por FRENTES de calle**: cada casilla de calle con su
   tangente; el edificio se sienta pegado a la calle, ROTADO con la
   fachada paralela y la puerta mirándola (rotación libre, no a 90°).
   Denso cerca de la plaza, granjas extramuros con campos de labranza
   junto a los caminos. Reparación de conectividad: toda puerta aislada
   abre senda A* (con puente si toca).
7. **Validación**: estanqueidad (flood con puertas tapadas), conectividad
   de todas las puertas, no-solape. Tests 7/7 en
   `ciudades/test/ciudad.test.js`.

**DECISIÓN nueva (a validar con el usuario): huella exterior COMPACTA de
catálogo** (`catalogo/huellas.json`, por riqueza + por tipo). La planta
1:1 del interior real resultó inviable: el motor de interiores genera
plantas de 30+ casillas de ancho (escuela 34×17, joyería 36×12) — más
anchas que media aldea, imposible el aspecto de las referencias. Como el
interior es una INSTANCIA (otra room), no necesita caber físicamente en
la huella; el bake anidado sigue generando y enlazando el interior
completo de cada edificio. Es el estándar de los juegos con interiores
instanciados.

### 6.1 Capas añadidas (2026-08-27, pedido del usuario)

- **Vegetación**: arbustos atravesables y árboles sueltos ("verde por aquí,
  verde por allá") por el recinto + arbustos en los parques — especies del
  catálogo del baker (t:"v"; la colisión la decide su catálogo).
- **Decoración urbana** (t:"m", catálogo NUEVO
  `ciudades/catalogo/decoracion.json` con colorDebug/dimensiones/colision/
  luz por pieza): vallas cercando huertos, puestos de mercado y bancos en
  la plaza, cajas/barriles/sillas/sacos junto a fachadas. Regla dura: la
  deco que colisiona nunca pisa un camino ni tapona una puerta. El cliente
  la instancia con categoría de assets "interiores" (mismo .glb que el
  mueble cuando exista); el servidor lee su colisión del catálogo.
- **CANAL DE ILUMINACIÓN**: farolas (ricos) / antorchas de poste (pobres)
  en plaza, puertas de muralla y calle principal — como deco Y como canal
  aparte `indice.luces` ({x, y, id, radio, color}) para que el ciclo
  día/noche futuro encienda ahí sus luces.
- **Tier `gran_capital`**: el DOBLE de radio que la capital (112 vs 56,
  mapa 328×328), 4 puertas, 64-80 edificios, DOS calles de ronda (la
  interior y otra pegada a la muralla) para que todos los anillos tengan
  barrio. Escala completa: aldea_pequena → aldea → pueblo → capital →
  gran_capital + castillo.
- **Formas**: todas las plantas nacen de rectángulos/cuadrados compuestos
  (decisión del usuario): rect, L (un ala), T (ala centrada) o U (dos
  alas), por semilla en los tipos con "alas" de huellas.json.
- **PLAN DE SUELO exportado + .glb por instancia** (vinculación con
  taller-vox, decidida por el usuario 2026-08-28): el indice.json exporta
  `edificios` — la forma REAL de cada instancia ({id, tipo, semilla, cx,
  cy, rot, w, h, piezas, puerta}, coords locales con la puerta en +Y). De
  ahí lee `taller-vox/generar_edificios_ciudad.js` para generar el .glb de
  CADA edificio siguiendo exactamente ese plan (mismo w/h con jitter,
  mismas alas L/T/U en su sitio, plantas del interior anidado y la MISMA
  semillaInterior: fachada, forma e interior nacen del mismo tiro de
  dados). El modelo vóxel nace con la puerta en z bajo; la `rot` del mapa
  hace el resto. Salida a `<carpetaCiudad>/edificios_glb/` (preview): los
  .glb NO se suben a assets/ sin el flujo de aprobación del taller.

Pendiente: que el CLIENTE cargue esos .glb por instancia (hoy pinta una
caja por riqueza con la huella w/h real de cada edificio — el paso al .glb
espera a que el usuario apruebe el arte), hito de plaza, bakeado especial
de la ciudad principal, ciclo día/noche que consuma `indice.luces`. El
export en formato de sectores está verificado contra `mapaColision` del
servidor y JUGADO de verdad (assets/mapas/ciudad_demo + paseo E2E con
vídeo).

## 7. Vinculación con `baker/` (mapa exterior principal) — 2026-08-28

Antes: `baker/` colocaba los ~40 tipos de POI de `baker/catalogo/pois.json`
como simples MARCADORES (`{id, tipo, bioma, x, y, radio, faccion,
legendario}`) — sin geometría, sin interior, sin puerta; el campo `pois`
de cada sector llegaba al cliente pero no lo consumía nadie
(`formatoMapa.ts: pois: unknown[]`). Pedido del usuario: "vincular todos
los baker para el día que creemos el mapa se cree todo a la vez y
vinculado" — un POI es de un tipo (aldea con su puerta, un edificio
exterior 3D suelto, o algo puramente decorativo) y su estética/mecánica
debe generarse SOLA al hornear el mapa grande, sin paso manual.

**Tres categorías por plantilla de catálogo** (`categoria` en
`pois.json`, documentado ahí mismo en `_nota_categoria`):

- **`asentamiento`** (`tier`, uno de `ciudades/catalogo/asentamientos.json`:
  aldea_pequena/aldea/pueblo/capital/castillo/gran_capital): hornea una
  región `ciudades/` COMPLETA y anidada — misma pieza que ya existía, ahora
  disparada automáticamente. `aldea_agricola`, `aldea_maderera`,
  `aldea_pescadores`, `ciudad_poblada_menor`, `fuerte_barbaro`,
  `castillo_en_ruinas`.
- **`edificio`** (`tipoEdificioId`, uno de
  `interiores/catalogo/tipos_edificio.json`): UN edificio suelto
  directamente sobre el mapa padre — su interior sale de
  `interiores/generarEdificio` igual que cualquier otro, sin muralla ni
  calle alrededor. `granja_abandonada`/`ruinas_pequenas` → `ruina`,
  `cabana_cazador` → `casa_humilde`, `tienda_cazador`/`oasis_mercader` →
  `tienda`, `caravana_ambulante` → `carromato_mercader`, `barco_encallado`
  → `barco_encallado`, `faro_abandonado` → `faro`, `cabana_pesca` →
  `choza_pescador`, `choza_curandero` → `choza_curandero`,
  `guarida_bandidos`/`campamento_barbaros_grande` → `campamento_hostil`,
  `torre_vigia_enemiga` → `torre_militar`, `barracones_abandonados` →
  `cuartel_guardia`.
- **`decorativo`** (o sin `categoria`, valor por defecto): sin cambios —
  el marcador de siempre, sin instancia. Incluye deliberadamente
  `cueva_pequena/profunda`, `mazmorra_olvidada/antigua`, `mina_abandonada`
  y `guarida_lobo` (todas `tipo:"portal"` en el catálogo, es decir
  candidatas a instancia): el bakeador de mazmorras NO existe todavía
  (pedido explícito del usuario: "menos crear el generador de dungeon
  aun"), así que se dejan sin vincular hasta que exista — vincularlas será
  cuestión de darles `categoria` cuando llegue ese bakeador, sin tocar
  nada de esta pieza.

**`baker/src/instanciasPOI.js`** (nuevo): recorre los POIs ya colocados
por `pois.js`, y por cada uno con categoria "asentamiento"/"edificio":

- *asentamiento*: `hornearCiudad(tier, semillaPOI, <carpetaMapa>/pois/<slug>/)`
  y un portal `{tipo:"exterior", x, y, destino:{tipo:"region", mapaId:
  "<mapaId>/pois/<slug>"}}` — MISMO formato de `Portal` que ya consumía
  `RegionRoom`/`HubRoom`, cero cambios de servidor.
- *edificio*: `generarEdificio(...)` + su interior a
  `<carpetaMapa>/interiores/<id>.json` (misma carpeta/convención que ya
  usa `ciudades/`), un objeto `{i, t:"e", ro:0, w, h, dx:0, dy:0}` para la
  caja 3D (MISMO shape que ya pinta `sectorVisual.ts` para los edificios
  de `ciudades/`, cero cambios de cliente) y un portal
  `{tipo:"interior", x, y, edificio, tipoEdificioId}` con la puerta en +Y
  (fila justo debajo de la huella, mismo criterio que `ciudades/`).

**`baker/src/generar.js`**: llama a `generarInstanciasPOI` justo después
de `colocarPOIs`; la huella de cada "edificio" se marca como terreno
`solar_edificio` (bloquea el paso, misma convención que `ciudades/`) ANTES
de decorar esa zona (así ni el flag `transitable:false` ni el radio del
POI dejan brotar vegetación encima); su caja 3D se añade a los `objetos`
del chunk que le toca; `portales` (uno por POI asentamiento/edificio, más
los que ya hubiera) se escribe en `indice.json` junto al resto de
metadatos del mapa (mismo campo que ya leía `cargarMapaColision`).
`mapaId` se deriva del nombre de la carpeta de salida — solo tiene sentido
cuando el bake vive de verdad bajo `assets/mapas/`.

**Verificado con un bake real** (`baker/config/ejemplo-rapido.json`,
384×384 casillas, 24 POIs): 7 POIs "edificio" (ruinas, campamento hostil)
con caja 3D + interior real generados, 4 POIs "asentamiento" (incluido un
`fuerte_barbaro` tier castillo con NPCs poblados) horneados como región
anidada — ambos cargados y jugados de verdad con servidor+cliente reales
(Playwright, capturas en `client/test/capturas_poi/`, gitignored, script
en `client/test/prueba_visual_poi.cjs`): la caja de la ruina, su interior
con muebles reales, y la plaza del fuerte con NPCs y fauna del poblador
todo funcionando de punta a punta sin ningún paso manual entre bakeadores.
Regresión completa en verde (server 37/37, interiores 32/32, ciudades
8/8, tsc limpio en server y cliente).

Pendiente: los POI "decorativo" (ruinas medianas/grandes, altares, pozos,
círculos de piedra, campos de dunas, campamentos de paso...) TODAVÍA no
tienen ninguna estética propia — siguen siendo el marcador invisible de
siempre, sin ningún prop en el mapa. No hay catálogo de "estructuras
decorativas" en `baker/` (solo `rocas.json`/`vegetacion.json`, pensados
para dispersión natural, no para un clúster con forma reconocible tipo
"círculo de piedras" o "pozo"); habría que decidir con el usuario si esos
props salen de un catálogo nuevo (`baker/catalogo/estructuras.json`) o de
extender `ciudades/catalogo/decoracion.json` para reutilizarlo fuera de
las murallas.

Pendiente: estética distinta por FACCIÓN/tema dentro de una misma
categoría (hoy un `campamento_hostil` "edificio" usa el mismo
`tipoEdificioId` tanto para `guarida_bandidos` como para
`campamento_barbaros_grande` — mismo edificio, distinto id de catálogo,
sin variación visual propia todavía); orientación/rotación de los POI
"edificio" (hoy siempre `ro:0`, no busca el lado más despejado del
terreno); vincular las cuevas/mazmorras en cuanto exista el bakeador de
mazmorras.
