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
- **Arte del HITO de plaza generado y APROBADO (2026-09-04)**:
  `ciudades/src/generar.js` ya coloca el hito real por tier (pozo/fuente/
  estatua, sin tocar en esta pasada) pero sus 3 ids de
  `ciudades/catalogo/decoracion.json` (`pozo_agua`/`fuente_piedra`/
  `estatua_piedra`) no tenían `.glb` — el cliente pintaba una caja. Nuevo
  arquetipo en el taller de vóxeles, `taller-vox/generar_hitos_plaza.js`
  (mismo patrón que `generar_naturaleza.js`: lee colorDebug/dimensiones
  DIRECTO de `decoracion.json`, sin catálogo nuevo), 3 variantes por
  semilla de cada pieza (pozo: brocal cuadrado/octogonal + postes/viga/
  torno + cubo colgante de una cuerda; fuente: plato con lámina de agua +
  pilar + remate con agua opcional; estatua: pedestal + plinto + figura
  heráldica estilizada — nunca realista — con brazo/objeto alzado opcional
  en 2 de las 3 variantes). Galería de revisión
  `taller-vox/prueba_render_hitos_plaza.js` (SVG+PNG isométrico, mismo
  mini-render que `personajes/src/renderIso.js`) y suite
  `taller-vox/test_hitos_plaza.js` (8 tests: catálogo real, determinismo,
  cajas dentro de su propio grid, variedad entre variantes, tamaño
  coherente con `dimensiones` del catálogo, .glb exportado y válido —
  magic/JSON/BIN/índices). **Aprobado por el streamer y subido (2026-09-04)**:
  las 9 variantes (3 por pieza) ya están en `assets/interiores/
  {pozo_agua,fuente_piedra,estatua_piedra}_0{1,2,3}.glb` — misma convención
  de nombre `<id>_NN.glb` que ya consume `entityLoader.ts` para el resto de
  deco de `ciudades/` (categoría `interiores` porque `ciudades/src/index.js`
  exporta la decoración urbana con `t:"m"`, igual que cualquier mueble).
  `ciudades/src/generar.js` y `decoracion.json` NO se tocaron — la lógica de
  colocación ya estaba completa y correcta, solo faltaba el arte.

**Auditado 2026-09-04**: el cliente YA carga el `.glb` real por edificio sin
código nuevo (`sectorVisual.ts` prueba genéricamente `assets/edificios/
<tipoEdificioId>_NN.glb`, mismo mecanismo que el resto del proyecto) —
37 de los 46 `tipoEdificioId` de `ciudades/` ya tienen ese arte aprobado y
sentado ahí; solo los 9 tipos de oficios censados el 2026-09-04 seguían sin
`.glb` propio (caían a la caja).

**Los 9 restantes, cerrados (2026-09-07)**: `cabana_apicultor`/`cabana_cazador`/
`carniceria`/`cocina_comunal`/`peleteria`/`taller_arquero`/`taller_picapedrero`/
`vidrieria`/`astillero` ya clasifican solos como arquetipo TALLER en
`taller-vox/generar_edificio.js::clasificarEdificio` (vía `temaTaller`, sin
tocar el generador) — `generarEdificio(tipoId, n)` × 4 variantes +
`exportar_lote.js` directo a `assets/edificios/` (mismo "enganche rápido" ya
documentado en la cabecera de ese script para el lote de edificios, sin
revisión pieza a pieza). 36 `.glb` nuevos, validados con `validar_glb.js`
(magic/JSON/BIN/accessors/triángulos correctos, bounding box coherente con
la huella real de cada tipo). Los 46/46 `tipoEdificioId` de `ciudades/`
tienen ya arte real. Pendiente real: bakeado especial de la ciudad
principal. El export en formato de sectores está verificado contra
`mapaColision` del servidor y JUGADO de verdad (assets/mapas/ciudad_demo +
paseo E2E con vídeo).

**`indice.luces` consumido en el cliente (RESUELTO)**: `client/src/game.ts`
lee `indice.luces` al entrar en una región (no por streaming de sector —
son pocas decenas como mucho, se cargan todas de golpe igual que
fauna.json/poblacion.json) y crea un `THREE.PointLight` cálido por farola,
apagada de día y encendida de noche con el mismo parpadeo de llama que la
antorcha del guardia (`Math.sin` desfasado por posición, ver
GDD_Agentes_Moviles.md). Sigue pendiente el `.glb` real del poste (hoy solo
la luz, sin geometría propia — la farola/antorcha de poste como pieza de
`ciudades/catalogo/decoracion.json` ya se pinta con su placeholder de
siempre, esto solo añade la luz encima).

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

## 8. Confinamiento del recinto amurallado + muralla diferenciada — 2026-08-28

Dos bugs/huecos reportados por el streamer tras jugar de verdad un
asentamiento amurallado:

**1. Se podía salir caminando de la aldea sin usar la puerta.** El bake de
`ciudades/` cubre un lienzo (`ancho x alto`) bastante más grande que el
propio anillo de muralla, para tener sitio donde trazar el camino de
acceso y la hidrología — pero ese lienzo entero era terreno transitable
normal. Resultado: un jugador podía cruzar el hueco físico de la puerta
(nunca fue una pared sólida, es un hueco real en el rasterizado) y
seguir caminando por ese "anillo verde" sin fin, sin haber cruzado nunca
el portal real (la interacción con tecla F en la puerta, que es la que de
verdad te manda de vuelta al mapa padre). Arreglado en
`ciudades/src/generar.js`: toda casilla FUERA del polígono de la muralla
(salvo un despejado corto alrededor de cada puerta, sitio para el
abrevadero/carreta que ya se colocaban ahí y para el radio de
interacción del portal) se convierte a un terreno nuevo, `extramuros`
(`baker/catalogo/terrenos.json`, MISMO `colorDebug` que césped —
visualmente idéntico, pero `transitable:false`). El hueco físico de la
puerta sigue existiendo tal cual (no se tocó el rasterizado de la
muralla ni la detección de puertas): la única forma de verdad de salir
sigue siendo el portal de interacción. Verificado con flood-fill real
desde el spawn contra un bake real: antes del arreglo el área alcanzable
cubría prácticamente el lienzo entero (112×112); después, ~2200 casillas
contenidas en el recinto + el despejado de la puerta.

**2. La muralla no distinguía torres ni puertas — todo era un bloque
uniforme.** `ciudades/src/generar.js` ya calculaba `modulosMuralla`
(recto/torre/puerta, con material y rotación) desde el principio, pero el
cliente lo ignoraba por completo: `sectorVisual.ts` solo extruía cada
CASILLA de terreno `muralla_piedra`/`empalizada` como una caja uniforme,
así que un tramo recto, una torre y una puerta se veían exactamente
igual (un corte sin nada más). Ahora `crearMurallaSector` (nuevo, en
`sectorVisual.ts`, usando el campo `muralla.modulos` ya exportado a
`indice.json` — se añadió su tipo a `IndiceMapa`) añade, SOLO para
torre/puerta (el tramo recto ya está resuelto por la extrusión de
terreno):
  - **torre**: una caja más ancha y alta en el vértice.
  - **puerta de piedra** (`muralla_piedra`): dos torreones flanqueando el
    hueco — una entrada de fortaleza de verdad, pedido explícito
    ("torreones de piedra con el portón, como las de antes").
  - **puerta de empalizada**: dos palos simples y finos, sin sillería —
    una aldea humilde no tiene torreones de piedra (pedido explícito:
    "las empalizadas deberían ser más sencillas con palos y tal").
Puramente decorativo (no toca colisión: el hueco real ya lo resuelve el
terreno). Verificado con capturas reales de una aldea_pequena
(empalizada) y un pueblo (piedra) — `client/test/prueba_render_murallas.cjs`.

Regresión completa en verde tras ambos cambios (ciudades 8/8, interiores
32/32, server 37/37, tsc limpio en cliente y servidor).

**Sigue pendiente** (no se tocó en esta tanda): el tramo recto y las
torres siguen siendo geometría placeholder simple (cajas), no un modelo
`.glb` de muralla de verdad — mismo criterio de "todo el arte es
placeholder" que el resto del proyecto. La visión de largo plazo,
confirmada por el streamer: cuando exista el pipeline de arte real
(`.glb` aprobados), "bakea mundo" debería encadenar TODOS los
bakeadores automáticamente (mapa → POIs → aldeas → edificios/interiores,
ya vinculado por la sección 7) sin ningún placeholder de por medio — la
maquinaria de encadenado ya existe (`baker/src/instanciasPOI.js`), solo
falta el arte que sustituya a las cajas de color.

## 9. Prop 3D exterior de la ciudad (silueta/skyline), 2026-09-08

Cierra el pendiente real que quedaba de §4.4 (línea 124-131, "Representación exterior = dos salidas del mismo bake"): un POI `categoria:"asentamiento"` (una ciudad/aldea entera de `ciudades/`, anidada) solo dejaba el portal en el mapa padre — CERO rastro visual/de colisión, a diferencia de un POI `categoria:"edificio"` suelto, que sí planta su caja 3D (`t:"e"`) y reserva su huella entera como terreno `solar_edificio` (bloquea el paso).

**Arreglado reusando el MISMO mecanismo genérico que ya usan los POI "edificio"** (`baker/src/instanciasPOI.js`, rama `categoria === "asentamiento"`): tras hornear la ciudad anidada (`hornearCiudadPerezoso()`, cuyo valor de retorno antes se descartaba), se captura `ciudad.ancho`/`ciudad.alto` (el footprint REAL de todo el asentamiento, no el tamaño fijo de un edificio suelto) y se planta un `objetosPorPOI` con `t:"e"`, `i:"ciudad_<tier>"` — mismo objeto genérico que `generar.js` ya sabe convertir en (a) una caja 3D por convención de nombre (`sectorVisual.ts` ya prueba `assets/edificios/<tipoEdificioId>_NN.glb` sin ningún cambio de cliente) y (b) terreno `solar_edificio` reservado en TODA la huella (`footprintEdificiosPOI`, `generar.js`) — "todo su volumen bloquea el paso", exactamente lo que pedía §4.4. Un `tipoEdificioId` sintético (`ciudad_aldea_pequena`, `ciudad_pueblo`...) sin ningún `.glb` real cae automáticamente al placeholder de caja de color ya existente — es literalmente el "mientras tanto placeholder de cajas... generado del propio layout" que el propio §4.4 ya daba por aceptable; el `.glb` real de una miniatura de ciudad de verdad es arte pendiente aparte, no código nuevo.

Verificado: llamada directa a `generarInstanciasPOI` con un POI `asentamiento` sintético (sin bake completo) confirma el `objetosPorPOI` resultante con la huella real (aldea_pequena real: 112×112 casillas) y el portal intacto; bake completo de `baker/config/ejemplo-rapido.json` (12×12 chunks, el único bake de prueba permitido) corrido de punta a punta sin errores nuevos (mismo único aviso preexistente de caminos sin ruta, ajeno a este cambio) — esa pasada concreta no colocó ningún POI `asentamiento` real (solo `mazmorra-asentamiento`, rama DISTINTA sin tocar), así que la cobertura de un bake completo con un asentamiento de verdad queda para cuando el streamer corra un bake de producción con uno.

## 10. Población automática de CADA asentamiento — cierra un "sin paso manual" que en realidad no lo era (2026-09-08)

Auditoría fresca del pipeline de bake completo (pedido streamer: "revisa todo... no falta ningún cabo suelto... nos metemos a bakear mapeado nuevo... Isla 1") encontró que la frase de §7 ("todo funcionando de punta a punta sin ningún paso manual entre bakeadores") y la de §9 arriba eran ciertas para ciudad+interiores+portales, pero NO para población: `baker/src/instanciasPOI.js` solo llamaba a `hornearCiudad(tier, semillaPOI, carpetaPOI)` — que genera terreno/edificios/interiores/fauna, pero NUNCA población — así que cada asentamiento que saliera de un bake exterior grande se quedaba sin ningún `poblacion.json`, salvo que alguien corriera `node poblacion/src/exportarAsentamiento.js <tier> <semilla> <carpeta>` A MANO, uno por uno, por cada aldea/pueblo/ciudad/capital del mapa (podrían ser docenas en una isla real). Pedido streamer explícito al confirmarlo: "todas incluidas capital deben tener generador automático de población".

**Arreglado**: `baker/src/instanciasPOI.js` gana `poblarAsentamiento(tier, semillaPOI, carpetaPOI, onProgreso)` (require perezoso de `poblacion/src/exportarAsentamiento.js::exportarAsentamiento`/`escribirPoblacionDeMapa`, mismo patrón que `hornearCiudadPerezoso`), llamada automáticamente justo después de `hornearCiudad(...)` en la rama `categoria === "asentamiento"` — MISMO tier+semillaPOI, así que `generarCiudad` (que `exportarAsentamiento` recalcula internamente para asignar vivienda/trabajo) da la ciudad IDÉNTICA por determinismo de semilla, sin tener que pasarle el objeto `ciudad` ya horneado. Un fallo puntual (p.ej. Gemini caído si hay `GEMINI_API_KEY` puesta) se atrapa con try/catch y solo deja SIN población a ESE asentamiento — nunca tira el bake del mapa entero, mismo criterio que "catálogo mal referenciado: se omite el POI, no rompe el bake" ya usado en este mismo archivo. `generarInstanciasPOI` pasó de síncrona a `async` (necesita `await` real para la posible llamada de red) — propagado a sus dos únicos llamadores reales, `baker/src/generar.js::generarMapa` (también ahora `async`) y sus dos consumidores, `baker/src/index.js` (CLI, ahora `main().catch(...)`) y `baker/gui/servidor.js` (ya estaba dentro de un handler `async`, solo le faltaba el `await`).

**A propósito SIN tocar**: la rama `categoria === "mazmorra"` con `estiloExterior === "asentamiento"` (campamentos hostiles tipo `guarida_bandidos`/`poblado_orco`) — esos son facción bandida (`docs/GDD_Faccion_Bandidos.md`), poblarlos con `poblacion/` metería vecinos civiles con rutina de tienda/taberna donde debería haber tropas hostiles; sigue siendo el mismo "sin enemigos dentro de las casas todavía" ya documentado, ahora con un comentario explícito en el código para que nadie lo "arregle" por error extendiendo `poblarAsentamiento` ahí.

Verificado: `ciudades/test/ciudad.test.js` 13/13, `poblacion/test/*.test.js` sin regresión (mismo fallo preexistente y ajeno "campesinos del mismo huerto"), `mazmorras/test/mazmorra.test.js` 13/13, bake real de `baker/config/ejemplo-rapido.json` sin errores nuevos. Prueba dirigida (no un bake grande — llamada directa a `generarInstanciasPOI` con un POI sintético, mismo criterio que §9): confirmado que un asentamiento `aldea_pequena` (5 NPCs) y uno `capital_jarl` (196 NPCs) generan su `poblacion.json` automáticamente en `<carpeta>/pois/<slug>/poblacion.json`, con NPCs reales con rutina — CERO paso manual, para CUALQUIER tier, capital incluida. **Sigue sin probarse dentro de un bake grande real con un asentamiento civil de verdad colocado por el RNG** (el único bake de prueba permitido no colocó ninguno esta vez) — la prueba dirigida cubre la lógica exacta que se ejecutaría, pero la primera vez que esto corra dentro de un bake de producción real es la confirmación definitiva.

## 11. `capital`/`castillo`/`gran_capital` NUNCA podían salir en el mapa exterior — gap real de catálogo, no de código (2026-09-08)

Al preparar el primer bake de producción real ("Isla 1"/Vetrheim) se descubrió que `baker/catalogo/pois.json` — el catálogo que decide qué puede colocar `colocarPOIs()` en el mapa exterior — solo tenía **4** entradas `categoria:"asentamiento"` en total: `aldea_agricola` (tier `aldea`), `ciudad_poblada_menor` (tier `pueblo`), `aldea_maderera`/`aldea_pescadores` (tier `aldea_pequena`, bosque/costa). Los otros 3 tiers regionales reales de `ciudades/catalogo/asentamientos.json` — `capital`, `castillo`, `gran_capital` — **no tenían NINGUNA entrada**: por diseño o por seed, jamás podían aparecer en un mapa exterior, por muchas veces que se rehorneara. El propio comentario de este archivo (§4, línea ~299) ya listaba los 6 tiers regionales como "uno de `ciudades/catalogo/asentamientos.json`: aldea_pequena/aldea/pueblo/capital/castillo/gran_capital" — la intención de diseño siempre fue que los 6 fueran alcanzables, solo faltaban 3 entradas de catálogo. (`capital_jarl` es DISTINTO a propósito y no entra aquí — es la capital única del jarl/admin, `docs/GDD_Ciudad_Capital.md`, bakeada aparte con `node ciudades/src/index.js capital_jarl <semilla>` como su propio mapa `RegionRoom`, nunca anidada como POI del exterior.)

**Arreglado**: 3 entradas nuevas bajo `pradera` (mismo bioma que `aldea_agricola`/`ciudad_poblada_menor`, `reglasSitio:["terrenoLlano"]`) — `capital_regional` (tier `capital`, radio 20, peso 0.6), `gran_metropoli` (tier `gran_capital`, radio 30, peso 0.2), `castillo_real` (tier `castillo`, radio 12, peso 1.5). Pesos calibrados EMPÍRICAMENTE (no de una fórmula): con `separacionMinimaPOI:200` en un mapa de 100×100 chunks, el pool combinado pradera+universal pesa ~151 antes de este cambio — `pueblo` (peso 0.6, ya existente) resultó no aparecer NI UNA VEZ en 14 semillas de sondeo antes de este ajuste, así que los pesos iniciales que se probaron para capital/castillo/gran_capital (0.3/0.12/1) tampoco dieron ningún resultado en 5 semillas más; subidos a los valores de arriba (capital al nivel de pueblo, castillo algo más común por ser un punto defensivo, gran_capital el más raro de los tres) y se sondearon más semillas — ver el commit de bake de producción para la semilla final elegida y el recuento real de asentamientos que dio. Sondeo hecho con un script de sondeo rápido (no comiteado, reproduce el prefijo real de `generar.js` hasta `colocarPOIs()` sin pagar el coste de exportar terreno/decoración — valida byte a byte contra un bake real completo antes de confiar en él) para no pagar ~900s por semilla candidata.

**Nota de balance, a propósito sin resolver aquí**: estos pesos priorizan que la primera isla de producción tenga de verdad un asentamiento grande — no son necesariamente los pesos finales para futuras islas/DLC de mapa; si hace falta re-balancear rareza más adelante, este es el sitio.

**Semilla final y resultado real (`baker/config/vetrheim.json`, semilla `"vetrheim-16"`, elegida tras sondear 20 candidatas)**: bake completo de producción (100×100 chunks, 907.6s, "Validación: OK", 0 POIs sin ruta) con 69 POIs — 4 asentamientos civiles (`aldea_maderera` 18 NPC, `aldea_agricola` 42 NPC, `capital_regional` tier `capital` 81 NPC, `castillo_real` tier `castillo` 12 NPC — confirma de verdad, no solo por prueba dirigida, que la población automática de §10 funciona dentro de un bake grande real con asentamientos colocados por el RNG), varios campamentos hostiles y ~35 mazmorras/cuevas. Staged en `output/vetrheim/`, pendiente de que el streamer decida promocionarlo a `assets/mapas/principal/` (reemplazar el mapa en vivo es un paso aparte de correr el bake, ver `CLAUDE.md`).

## 12. Puerta de asentamiento real — el portal vivía DENTRO de su propio `solar_edificio`, inalcanzable a pie (2026-09-09, pedido streamer jugando: "la capital sigue viéndose por fuera un placeholder, debería verse una aldea con puerta y poder entrar por ella")

Investigando la queja se encontró que no era solo cosmética: `baker/src/instanciasPOI.js`, rama `categoria === "asentamiento"`, dejaba el portal (`tipo:"exterior"`) en `(poi.x, poi.y)` — el CENTRO GEOMÉTRICO exacto del asentamiento — mientras que el mismo bloque reserva TODA la huella (`ciudad.ancho x ciudad.alto`, hasta ~370x370 casillas en una `gran_capital`) como terreno `solar_edificio` (bloqueado, `baker/src/generar.js` línea ~418). El centro es el punto MÁS adentro posible de ese bloqueo — ningún jugador podía llegar nunca a `RADIO_INTERACCION` (2.2 casillas, `RoomExteriorBase.ts`) del portal, así que `portal:usar` jamás encontraba nada dentro de rango: la puerta de la capital era matemáticamente inalcanzable a pie desde que existe esta rama (2026-09-08), no solo "fea".

**Arreglado en dos piezas**:
- **Puerta real y pequeña**: `taller-vox/generar_puerta_asentamiento.js` (nuevo, mismo patrón exacto que `generar_hitos_plaza.js` — Builder/caja + PRNG por variante, arquetipo propio) genera una estructura de arco de piedra (2 pilares + lintel + tramos de muro laterales que sugieren la muralla real, almenas/estandarte variando por semilla) con huella FIJA `[6,2]` casillas — deliberadamente pequeña e independiente del tier (la escala del asentamiento la sigue comunicando la caja grande de siempre, sin tocar). 4 variantes exportadas directo a `assets/edificios/puerta_asentamiento_0{1..4}.glb` (enganche rápido, mismo criterio ya usado para el lote de 36 edificios de ciudad/herramientas/armas esta sesión — validado estructuralmente con `taller-vox/validar_glb.js`, sin revisión pieza a pieza).
- **Portal movido de verdad**: la puerta se coloca pegada al borde SUR de la caja grande (mismo `tipoEdificioId` sintético → mismo camino genérico `t:"e"` que ya usa la caja, cero cambio de cliente) y el portal cae 1 casilla más al sur de ELLA — terreno normal, caminable, fuera de CUALQUIER huella sólida (mismo convenio "+1 fila fuera de la huella" que ya usaba el POI "edificio" suelto en este mismo archivo).

Verificado con una llamada real a `generarInstanciasPOI` (POI `asentamiento`/`aldea_pequena` sintético, sin necesitar un bake grande): footprint de la caja 112x112 centrado en (500,500), puerta en (500,557) huella [6,2], portal final en (500,559) — confirmado que el portal NO cae dentro del footprint sólido combinado (antes sí, en el centro) y que sus 4 casillas vecinas tampoco, terreno abierto alrededor. `.glb` de las 4 variantes validado estructuralmente (128-376 vértices, bounding box `[6, ~2.1-2.5, 2]`, coherente con la huella). Bake real de `ejemplo-rapido.json` sin errores nuevos (no colocó ningún asentamiento civil esta tirada — solo campamentos hostiles, rama distinta sin tocar — pero confirma que el resto del pipeline sigue intacto). **Rebakeado y promocionado el mismo día** (mismo rebake de Vetrheim que aplicó también §15 de `GDD_Bakeador_Exteriores.md` y el panal salvaje de `GDD_Profesiones.md`): "Validación: OK", 4/4 `puerta_asentamiento` colocadas (una por asentamiento civil), portal de `capital_regional` confirmado en el bake real en (1534,2233) — terreno `roca` (transitable, `modVelocidad:0.6`) fuera de CUALQUIER huella sólida, a diferencia del bug original en (1534,2138), el centro exacto del footprint.

### Segundo bug real, encontrado verificando la puerta EN VIVO (no en los datos): el portal daba ENOENT al cruzarlo — mismatch entre el nombre de la carpeta del bake y la carpeta de despliegue

Verificar "¿se puede cruzar la puerta de verdad?" con un cliente real (no solo revisar el JSON) sacó un SEGUNDO bug, más grave que el primero y presente desde el día 1 de "Isla 1" (2026-09-08) — nunca detectado porque hasta el fix de arriba nadie había podido siquiera LLEGAR al portal para probarlo. `baker/src/instanciasPOI.js` horneaba el `destino.mapaId` de cualquier portal a un asentamiento anidado como `${mapaId}/pois/${slug}`, donde `mapaId` es el nombre de la carpeta de SALIDA del bake (`path.basename(carpetaSalidaResuelta)` en `generar.js` — para Vetrheim, `"vetrheim"`, porque el bake escribe a `output/vetrheim/`). Pero el mapa se PROMOCIONA después a `assets/mapas/principal/` — una carpeta con OTRO nombre — y `server/src/mundo/resolverMapa.ts::rutaDeMapaId` resuelve `mapaId` SIEMPRE como `assets/mapas/<mapaId>` literal, sin ningún indirection. Resultado real, confirmado con un cliente Playwright real cruzando la puerta: `ENOENT: .../assets/mapas/vetrheim/pois/capital_regional_1534_2138/indice.json` — la carpeta `assets/mapas/vetrheim/` nunca existió, el mapa vive en `principal/`. Cualquier portal a CUALQUIER asentamiento anidado (civil u hostil) de "Isla 1" ha estado roto desde que se promocionó por primera vez.

**Arreglado en dos capas, mismo patrón que el bug del `:` de Windows (2026-09-08)** — código para que no vuelva a pasar + migración de los datos ya horneados:
- **Bake**: `instanciasPOI.js` ya NO recibe ni usa el parámetro `mapaId` (eliminado de la firma junto con su único caller en `generar.js`) — el `destino.mapaId` de un portal anidado se hornea SOLO con la parte relativa, `pois/<slug>`, sin ningún nombre de mapa por delante.
- **Servidor**: `RoomExteriorBase.ts` gana `resolverMapaIdDestino(mapaId)` — si empieza por `"pois/"` (una referencia relativa del bake), la completa con `this.mapaIdPropio` (que SÍ refleja la carpeta real de despliegue, `path.basename(RUTA_MAPA)`); cualquier otra cosa (p.ej. un borde de mundo hacia otra isla, `bordesMapa`) se deja tal cual, ya es una referencia de nivel superior real. `HubRoom.ts`/`RegionRoom.ts` (los dos únicos sitios que reenvían `portal.destino.mapaId` al cliente en `portal:usar`) lo usan antes de mandar `portal:ir`. Los portales `tipo:"interior"` NO tenían este bug — ya usaban `this.mapaId`/`path.basename(rutaMapa)` en vivo, nunca un string horneado.
- **Migración de los datos ya promocionados**: reemplazo de texto directo en `assets/mapas/principal/indice.json` (`"vetrheim/pois/"` → `"pois/"`, 12 ocurrencias — los 4 asentamientos civiles + 8 campamentos hostiles con `estiloExterior:"asentamiento"`) — no hizo falta rehornear otra vez, es un cambio de FORMATO de un string, no de contenido del mapa.

**Verificado de punta a punta con un cliente real** (servidor+Vite+Playwright sobre el mapa `principal` completo, 169MB, teleport admin a la puerta real de `capital_regional`): antes del fix, `portal:usar` disparaba la creación de la `RegionRoom` que SÍ intentaba cargar la carpeta pero reventaba con el ENOENT de arriba (visible en el log del servidor); después del fix, el log confirma `Región "capital-vetrheim-16:poi:capital_regional_1534_2138" (principal/pois/capital_regional_1534_2138): 184x184 casillas` + `81 NPCs en el mapa` + `12 animales sueltos` — la región anidada carga de verdad, con capturas de pantalla confirmando al jugador de pie junto a la puerta de piedra real y, tras cruzar, dentro de la capital junto a NPCs reales con nombre. `tsc --noEmit` limpio. **Sin test automatizado nuevo** (la verificación fue con el arnés Playwright de esta sesión, no comiteado como e2e permanente — candidato real para un `client/test/*.e2e.mjs` futuro que cubra cruzar un portal de asentamiento anidado de punta a punta, hueco de cobertura real que no existía antes de esta noche tampoco).

## 13. El "cuadrado morado" — silueta 3D real de CUALQUIER asentamiento, y un tercer bug (más grande) encontrado auditando el mismo código: los campamentos hostiles no tenían NI SIQUIERA la caja placeholder

Pregunta directa del streamer jugando (2026-09-09, tras confirmar los fixes de §12): "se sigue viendo sin hornear el exterior prop de la aldea capital jarl no? sigue siendo cuadrado morado". Confirmado con certeza absoluta leyendo el código: el `tipoEdificioId` sintético `ciudad_<tier>` (usado desde 2026-09-08 para la caja grande de bulto del asentamiento) NUNCA tuvo `.glb` real — y como ese id ni siquiera existe en `interiores/catalogo/tipos_edificio.json` (es sintético, no un tipo de edificio real), la resolución de color de placeholder (`client/src/render3d/catalogoVisual.ts::colorObjeto`) no podía ni caer al color-por-riqueza (`COLOR_RIQUEZA`) — caía derecho al ÚLTIMO fallback, `COLOR_DESCONOCIDO = "#b05ad8"`, un morado apagado a propósito ("canta a la vista = id sin entrada de catálogo", pensado como aviso de desarrollo, NUNCA pensado para llegar a producción) — de ahí el "cuadrado morado" exacto que describía el streamer.

**Cerrado con una silueta 3D REAL, no otra caja de color**: `taller-vox/generarSiluetaCiudad.js` (nuevo) — a diferencia de TODO el resto de `taller-vox` (arquetipo + unas pocas variantes pre-generadas, revisadas y subidas a mano), esta pieza es única POR INSTANCIA de asentamiento: cada ciudad tiene su propio polígono de muralla real (Perlin, irregular) y su propio reparto de edificios, así que un pool de "4 variantes" compartidas no tendría sentido. Se genera **en el mismo proceso de bakeo** (`baker/src/instanciasPOI.js` la llama directamente, perezosa, mismo criterio que `generarEdificio`/`generarMazmorra`) a partir del objeto `ciudad` REAL que ya devuelve `hornearCiudad()` — cero cálculo nuevo de forma/terreno, solo reutiliza datos ya calculados:
- `ciudad.modulosMuralla` (`{tipo:"recto"|"torre"|"puerta", x, y, rot, material}`, coordenadas reales en la rejilla local de la ciudad) → un bloque cuadrado SIN ROTAR por módulo no-puerta (las piezas de este taller nunca rotan — con módulos cada ~3 casillas trazando el polígono real, la densidad de bloques ya sigue la forma real de la muralla, irregular incluida, sin necesitar rotación por pieza), material empalizada=madera/piedra=piedra, torres más altas con un remate simple.
- `ciudad.edificios` (`{cx, cy, w, h}`, posición/tamaño reales) → una LÁMINA fina de "tejado" por edificio real (nunca el bloque entero desde el suelo — con hasta 125 edificios reales en `capital_jarl`, un bloque sólido multiplicaba el recuento de vóxeles por nada visible de más: desde la cámara isométrica fija de este juego una lámina se lee IGUAL que un bloque macizo).
- La puerta FUNCIONAL de §12 (`generar_puerta_asentamiento.js`) vive siempre en el borde de la huella entera, muy por fuera del polígono real de la muralla gracias a `MARGEN_EXTRAMUROS=16` casillas de respiro que `ciudades/src/generar.js` ya reserva alrededor de CUALQUIER tier — así que nunca hace falta forzar un hueco extra en la silueta para que coincidan con la puerta real.

**Coste medido y recalibrado antes de comitear** (primera versión con tejados de bloque completo: 12.3s y 2.2M vóxeles SOLO para `capital_regional` — inaceptable si se multiplica por los ~12 asentamientos de un mapa real): con la lámina fina, `capital` (184x184, 26 edificios) → 3.4s/650k vóxeles; `castillo`/`aldea_pequena` (112x112) → ~1s/210-250k; `gran_capital` (328x328, 68 edificios) → 9.4s/1.5M; `capital_jarl` (400x400, 125 edificios, la más grande de cualquier tier) → 13.9s/2.2M — algunos segundos más de bake total por asentamiento, sin comparación con los ~500s+ que ya tarda un mapa grande.

**Tercer bug real, encontrado auditando esta MISMA función para hacerle sitio a la silueta (no jugando)**: la rama "mazmorra" con `estiloExterior:"asentamiento"` (campamentos hostiles — bandidos/orcos/piratas/cultistas/bárbaros, `mazmorras/catalogo/tipos_dungeon.json`) llamaba a `hornearCiudad(...)` y **descartaba el resultado sin usarlo** — nunca llamaba a `objetosPorPOI.set(...)`, así que un campamento hostil no tenía NI SIQUIERA la caja placeholder morada: CERO footprint sólido (vegetación normal del bioma podía superponerse encima de sus edificios reales) y CERO rastro visual — y su portal, igual que la capital antes de §12, seguía en el centro geométrico exacto, tan inalcanzable a pie como lo fue la capital hasta esta misma noche. Un hueco MÁS grave que el de la capital (que al menos tenía una caja, aunque fuera morada), sin que nadie lo hubiera detectado porque estos POIs de facción bandida se investigan menos que la capital.

**Arreglado con el mismo mecanismo, factorizado**: `colocarSiluetaYPuertaDeAsentamiento(ciudad, poi, slug, semillaPOI)` (nuevo, dentro de `instanciasPOI.js`) generaliza el bloque entero de silueta+puerta+portal de §12 a una función compartida, llamada ahora por LAS DOS ramas (`categoria==="asentamiento"` civil Y `estiloExterior==="asentamiento"` hostil) — los campamentos hostiles ganan exactamente la misma silueta 3D real, footprint sólido y puerta funcional que cualquier aldea/capital civil, sin duplicar código.

**Bug adicional, del lado del CLIENTE, encontrado razonando sobre la posición antes de comitear la silueta** (no una regresión de esta pasada, uno preexistente que afectaba a CUALQUIER edificio con `.glb` real, no solo a esta pieza nueva): `client/src/render3d/sectorVisual.ts`, la rama que renderiza un `.glb` REAL para categoría `"e"` (edificio), posicionaba SIEMPRE con `globalX+0.5`/`globalY+0.5` — un centro fijo de "media casilla", IGNORANDO `obj.dx`/`obj.dy` (la fracción real del centro, que la rama PLACEHOLDER de la misma función SÍ lee, con un comentario explícito: "así la caja coincide con la huella real del terreno"). Para cualquier objeto cuyo centro real no caiga justo en fracción .5 — TODAS mis piezas nuevas de esta sesión, con huella par (`puerta_asentamiento`=[6,2], `ciudad_<slug>`=`[ancho,alto]`, siempre múltiplo de 8) — el modelo real se renderizaba desplazado hasta 0.5 casillas de su huella de colisión real. Arreglado igualando esa rama a la misma lógica `obj.dx`/`obj.dy` que ya usaba la rama placeholder. Verificado: `cd client && npx tsc --noEmit` limpio, `client/test/streaming.test.ts`+`sectorVisualDispose.test.ts` sin regresión (22/22 combinados).

Verificado: `node baker/src/instanciasPOI.js` cargando sin excepción, llamada real a `generarInstanciasPOI` con un POI sintético `mazmorra`/`aldea_bandidos` confirmando silueta+footprint+portal relativo generados correctamente (antes: nada); bake real de `ejemplo-rapido.json` con 2 `poblado_orco_poi` reales generando su `.glb` propio sin errores; servidor 1308/1308, `tsc --noEmit` limpio en cliente y servidor. **Pendiente real**: hace falta un rebake completo de Vetrheim (semilla `vetrheim-16`) para que la silueta llegue al mapa en vivo — ejecutado y promocionado a continuación de este commit. **Limitación conocida, documentada a propósito**: la puerta funcional (`puerta_asentamiento`) NO se alinea con ninguna puerta REAL del polígono de muralla (sigue en el borde sur fijo de §12, nunca rotada) — visualmente puede no coincidir con dónde la silueta muestra un hueco real de gate; alinearla con la puerta real más cercana (rotando la estructura con el campo `ro`, que sí soporta rotación real por instancia) es una mejora de fidelidad posible, no abordada esta pasada por alcance/tiempo.

### 13bis. Cuarto bug real, encontrado verificando en vivo la promoción: esquina-vs-centro — la silueta se renderizaba desplazada ~medio footprint entero (2026-09-09, misma noche)

Antes de dar el rebake por bueno se promocionó a `assets/mapas/principal/` y se verificó en vivo (servidor+cliente+Playwright reales, teletransportando junto a la puerta de `capital_regional`): la red SÍ pedía y cargaba (200 OK) `ciudad_capital_regional_1534_2138_01.glb`, pero lo que se veía no se parecía a una muralla — estructuras dispersas pequeñas, ninguna silueta reconocible cerca de donde debía estar.

Investigado a fondo (no descartado a la primera): `taller-vox/exportar_glb.js::exportarModelo` tiene un parámetro `centrarXZ` (por defecto `false`, "ancla por la esquina (0,0,0) — mismo convenio que llevaba desde el principio, sin tocar edificios/naturaleza/personajes", según su propio comentario) que `generarYExportarSilueta` pasaba como `false`. Con `centrarXZ:false`, el `.glb` exportado deja sus vértices en las coordenadas de rejilla LOCAL tal cual las autora `generarSiluetaCiudad.js` (que dibuja muralla/tejados en `[0, ciudad.ancho] x [0, ciudad.alto]`, SIN margen simétrico) — es decir, el origen local `(0,0,0)` del mesh queda en la ESQUINA de esa rejilla, no en su centro. Confirmado leyendo los accessors reales del `.glb` (min/max de la posición VEC3): `ciudad_capital_regional_1534_2138_01.glb` (antes del fix) tenía su contenido en X∈[38,148.3], Z∈[43.7,157.3] — centro real en (93.15, 100.5), NO en (0,0).

Pero `colocarSiluetaYPuertaDeAsentamiento` coloca el objeto con `x:poi.x, y:poi.y` (el CENTRO real del asentamiento — confirmado con la fórmula de la puerta, `poi.y + alto/2`, que solo tiene sentido si `poi.y` es el centro) y `dx:0, dy:0`. El renderizador (`sectorVisual.ts`) posiciona el mesh en `globalX+dx, globalY+dy` — con el mesh ANCLADO POR LA ESQUINA y colocado en el punto que se asumía CENTRO, el resultado es la silueta entera desplazada ~medio footprint (¡92 casillas en una capital de 184x184!) de donde debía estar — de ahí que no se viera nada reconocible cerca de la puerta.

**Arreglado cambiando `centrarXZ` a `true` para `generarYExportarSilueta`** (`baker/src/instanciasPOI.js`) — desplaza los vértices por `grid/2` (mitad de la rejilla nominal), que para esta pieza coincide con el centro real del contenido con un margen pequeño y aceptable (la muralla real de una ciudad orgánica no siempre cae perfectamente centrada en su propia caja delimitadora — residual medido tras el fix: ~1-11 casillas según el asentamiento, sobre un footprint de 92-184 casillas de lado, nunca más del ~16% de la extensión total). Regenerados EN SITIO (sin rebake completo — los datos de sector `x,y,dx,dy` no cambian, solo la geometría interna del `.glb` referenciado por id) los 12 `ciudad_<slug>_01.glb` YA promocionados + los 4 `puerta_asentamiento_NN.glb` (que con este mismo fix quedan PERFECTAMENTE centrados, residual exacto 0 — su contenido, sin margen alguno, ya llenaba `[0,grid]` simétricamente).

**Hallazgo colateral, real pero de blast radius mucho mayor, documentado y DEJADO FUERA de esta pasada a propósito**: la misma comprobación empírica (leer accessors min/max de `.glb` reales) confirmó que un edificio NORMAL de POI (`tienda_01.glb`, generado por `taller-vox/generar_edificio.js`, el mismo pipeline usado para TODOS los edificios sueltos del mapa desde 2026-09-04) tiene el MISMO problema estructural: contenido en X∈[0.4,9.8], centro real en (5.1,4.1), NO en (0,0) — y se coloca con la MISMA convención `x=poi.x(centro), dx:0`. Si el razonamiento de arriba es correcto, esto implica un desplazamiento real (aunque menor en términos absolutos, ~4-5 casillas para un edificio de ~9x8) para PROBABLEMENTE TODOS los edificios sueltos de categoría "edificio" ya bakeados en cualquier mapa del repo (`testflat`, `ciudad_demo`, `principal`) — un bug mucho más antiguo y de alcance mucho mayor que nunca se detectó porque nadie comparó pixel a pixel el mesh renderizado contra su huella de colisión invisible. Arreglarlo de raíz (aplicar `centrarXZ:true` a `generar_edificio.js` en general) es un cambio de blast radius alto bajo presión de tiempo — requeriría reexportar y reverificar CIENTOS de `.glb` ya subidos y aprobados en varios mapas — fuera de alcance de "arreglar el cuadrado morado" de esta noche. Pendiente real, priorizable cuando el streamer lo pida con su propio alcance.

Verificado: ground-truth de accessors `.glb` antes/después (esquina→centro confirmado numéricamente para los 16 archivos regenerados), Playwright real confirmando 200 OK en la carga de `ciudad_capital_regional_1534_2138_01.glb`/`puerta_asentamiento_03.glb`/etc. cerca de la puerta real, captura visual mostrando estructuras (muralla/tejados) en vez del cuadrado morado original. **Impresión visual, honesta**: el resultado no se lee como "una silueta de castillo sólida" desde lejos — el diseño de tejados-lámina-fina + bloques de muralla dispersos (elegido por coste de vóxeles, ver más arriba) da más bien una impresión de "estructuras dispersas asomando entre los árboles" que de un perfil urbano compacto; es una mejora real y sustancial sobre el cuadrado morado, pero no un hito de arte pulido — posible pulido futuro si el streamer lo pide tras verlo en persona.

### 13ter. Rediseño v2 completo: muralla continua, edificios sólidos densos y puerta alineada a un hueco real de la muralla (2026-09-09, misma noche, pedido explícito del streamer con dos imágenes de referencia)

El streamer respondió a las capturas de §13/§13bis con dos imágenes de referencia (una muralla/castillo denso y macizo, con edificios apiñados dentro) y feedback directo: "no se ve nada de eso... el asentamiento capital castillos debería verse desde fuera así... la puerta debe coincidir con una que se genere en la muralla... si es aldea empalizada madera... de piedra dentro [alguno], si es ciudad muralla y edificios dentro y si es castillo pues un castillo de piedra". Tres pedidos concretos, los tres cerrados en la misma pasada — `taller-vox/generarSiluetaCiudad.js` reescrito de raíz (v2):

1. **Muralla CONTINUA de verdad**: v1 dibujaba un bloque cuadrado cada ~3 casillas (los "módulos" ya calculados por `ciudades/`) — a esa separación se leía como pilares sueltos, no como un anillo. v2 recorre el polígono REAL (`ciudad.poligonoMuralla`, el mismo array de vértices que ya usa `ciudades/` para rasterizar el terreno de muralla) en pasos de ~0.5 casilla, con un bloque solapado en cada paso — confirmado NUMÉRICAMENTE (no solo a ojo) que la cobertura es continua: recorriendo el polígono real con el mismo muestreo, 558/574 puntos ocupados, el único hueco de 16 puntos consecutivos es el de la puerta real (intencional). El grosor se subió de 0.75-0.95 a 1.4-1.7 casillas tras verificar en vivo que un grosor fino se leía mal a la distancia/zoom de cámara del juego (geométricamente ya era continuo con el grosor fino también, pero visualmente no se notaba).
2. **Edificios SÓLIDOS y DENSOS**: v1 usaba una lámina fina de tejado flotante por edificio (barata en vóxeles, pero sin lectura de "ciudad" real). v2 dibuja un bloque completo desde el suelo (posición/tamaño/riqueza REALES de `ciudad.edificios`, incluida `interior.riqueza` para variar algo la altura) con un tejado escalonado de 2 capas encima — pedido explícito del streamer confirmado: "no tiene que reproducir qué edificios tiene dentro, es un 3D que simula el espacio que ocupa" — sigue sin reproducir el interior real pieza a pieza, pero ahora SÍ lee como un perfil urbano compacto en vez de piezas dispersas. Tiers con presencia real de "gran estructura central" (`capital`/`gran_capital`/`capital_jarl`/`castillo`) dan al edificio de MAYOR footprint real (normalmente el ayuntamiento/palacio que `ciudades/` ya prioriza cerca del centro) un 70% de altura extra — reusa el edificio real más grande, no inventa una torre de homenaje sintética.
3. **Material por tier**: YA VENÍA CORRECTO gratis — `ciudad.modulosMuralla[].material` ("empalizada"/"piedra", elegido una vez por `hornearCiudad()` según el tier) ya diferenciaba aldeas de ciudades/castillos sin tocar nada. v2 EXTIENDE ese mismo material a las paredes de los edificios de dentro: ~80% el material dominante de la ciudad, ~20% el contrario (mezcla minoritaria real, pedido explícito "de piedra dentro" en una aldea de madera).

**Puerta alineada a un hueco real de la muralla** (pedido explícito: "la puerta debe coincidir con una que se genere en la muralla"): `generarSiluetaCiudad` ahora devuelve `puertaPrincipal` (posición + ángulo tangente REALES, sacados de `ciudad.puertas[0]` — el cruce del camino principal con el anillo, el mismo punto que `ciudades/` ya usa para dejar el hueco real en su propia rasterización de terreno — más el módulo `tipo:"puerta"` más cercano de `ciudad.modulosMuralla` para el ángulo). `colocarSiluetaYPuertaDeAsentamiento` (`baker/src/instanciasPOI.js`) coloca ahí la estructura interactiva (`generar_puerta_asentamiento.js`, simétrica bilateral y longitudinalmente — cualquier `ro` que alinee su eje ancho con la tangente de la muralla vale, sin importar el signo, así que no hace falta acertar el signo exacto de la rotación) y el portal real, en vez del borde sur fijo de v1. La silueta deja un hueco real en el anillo en TODAS las puertas reales del polígono (no solo la principal), para que ningún otro cruce de camino se vea con la muralla cerrada encima.

**Tres bugs reales encontrados verificando en vivo (no dados por buenos con solo el código), los tres cerrados en la misma pasada**:

- **Escala 2.5x pequeña**: `generarSiluetaCiudad.js` bajó su resolución interna de U=10 (el resto de `taller-vox`) a U=4 (silueta mucho más grande, menos detalle por casilla necesario a la distancia de cámara del juego — ver cabecera del archivo para la justificación completa) — pero `exportarModeloGlb(modelo, id, path, 0.1, true)` en `instanciasPOI.js` seguía pasando `unit=0.1` FIJO, un valor que solo es correcto para U=10 (`U*unit=1.0`, la convención "1 casilla = 1 unidad de mundo" de todo el proyecto). Con U=4 fijo y unit=0.1, `U*unit=0.4` — la silueta entera se exportaba a un 40% de su tamaño real. Confirmado verificando en vivo: la muralla salía como un anillo diminuto muy por dentro de donde la puerta/portal (calculados en coordenadas de mundo reales, sin este error) sí caían — la puerta aparecía "flotando" lejos del anillo visible. Arreglado pasando `1/U` (importado desde `generarSiluetaCiudad.js`, que ya exportaba `U`) en vez del valor fijo.
- **Portal inalcanzable de nuevo, causa distinta a §13/§13bis**: el bloqueo de terreno de CUALQUIER "edificio" de POI (`baker/src/generar.js`) marca como sólido un rectángulo de tamaño `huella` CENTRADO en `(x,y)` — para la silueta entera, `huella:[ciudad.ancho, ciudad.alto]` (la caja delimitadora COMPLETA, que incluye `MARGEN_EXTRAMUROS=16` casillas de respiro alrededor de la muralla real, `ciudades/src/generar.js`) — bloquear esa caja entera dejaría la puerta real (que vive muy cerca del borde de la muralla, no de la caja) a decenas de casillas de terreno libre. Cerrado con 3 campos opcionales nuevos y retrocompatibles en `objetosPorPOI` (`xBloqueo`/`yBloqueo`/`huellaBloqueo`, `baker/src/generar.js`, caen a `x`/`y`/`huella` si no se pasan — CERO cambio para cualquier otro consumidor existente): `colocarSiluetaYPuertaDeAsentamiento` calcula la caja delimitadora REAL del polígono de muralla (con un margen pequeño de 4 casillas para torres/almenas) y bloquea SOLO esa — mucho más ajustada a "el espacio que ocupa la aldea/ciudad" (pedido explícito del streamer), y de paso dejando MUCHO más terreno extramuros caminable/decorable que antes. El empuje del portal hacia fuera se calcula con un raycast analítico contra ESA caja ajustada (no una distancia fija), así que sale correcto sin importar cuánto se desvíe `ciudad.focal` (el centro real usado para construir el polígono) del centro geométrico de la caja delimitadora completa — medido hasta 34 casillas de desviación en `capital_jarl`.
- **Muralla "de puntitos" en la primera pasada de v2**: con 1 paso de rasterización por casilla, el redondeo a vóxel entero (`Math.round(px*U)`) podía dejar huecos de 1 vóxel entre bloques nominalmente contiguos — subido a 2 pasos por casilla (solape barato, la muralla ya es la parte más ligera del coste total) — confirmado que esto NO era en realidad la causa visual dominante (el recorrido numérico del polígono YA daba cobertura continua antes de este cambio también), pero cierra el margen de seguridad del redondeo de todos modos. La causa visual real de "se ve como postes" resultó ser la combinación grosor-fino + cámara isométrica alejada del juego — resuelta subiendo el grosor (punto 1 de arriba), no la densidad de pasos.

**Coste de vóxeles, medido con `hornearCiudad`+`generarSiluetaCiudad`+`exportarModelo` reales antes de comitear** (peor caso de cada tier, varias semillas hasta encontrar una válida): `aldea_pequena`/`castillo` (112x112) instantáneo; `capital` (184x184, ~27 edificios) 1.7s/377k vóxeles; `gran_capital` (328x328, ~73 edificios) 5.7s/1.01M; `capital_jarl` (400x400, ~111-129 edificios, la más grande de cualquier tier) 9.3s/1.38M — el peor caso sigue siendo una fracción del tiempo total de un bake grande (~500s+), y en la práctica la mayoría de asentamientos de un mapa real son de tiers mucho más baratos (Vetrheim: 4 civiles, ninguno `capital_jarl`).

**Herramienta de verificación visual nueva, committeada** (mismo patrón que `client/test/nieveAislado.ts`, sin servidor de juego ni bake completo): `client/test/generarSiluetaTestSector.js [tier]` genera un sector aislado con UN asentamiento real (vía `generarInstanciasPOI` de verdad, replicando la transformación exacta de `generar.js`) → `client/test/siluetaAislada.html?vista=cerca|lejos` lo renderiza con el mismo `crearSectorVisual` del juego real → `client/test/siluetaAisladaCaptura.mjs` automatiza la captura con Playwright. `client/test/verGlbAislado.html?url=...` (nuevo, genérico) carga cualquier `.glb` directo con `GLTFLoader`, sin pasar por `sectorVisual.ts` — útil para descartar el pipeline de instanciado como fuente de un bug (así se aisló el bug de escala de arriba: el `.glb` en sí, visto con este visor, ya se veía mal proporcionado ANTES de tocar `sectorVisual.ts`).

Verificado: `cd server && npm test` 1308/1308, `cd client && npx tsc --noEmit` limpio, `ciudades/test/ciudad.test.js` 13/13, `taller-vox/test_edificio.js`+`test_hitos_plaza.js`+`test_pj.js`+`test_muebles_proporcion.js` 50/50, bake real de `ejemplo-rapido.json` con 3 campamentos hostiles nuevos generando su silueta+puerta sin errores (`.glb` validados estructuralmente con `taller-vox/validar_glb.js`), y verificación visual real (Playwright, `siluetaAisladaCaptura.mjs`) para `aldea_pequena` (empalizada de madera, puerta bien encajada en el hueco visible del anillo) y `capital` (piedra, edificios densos y variados, torres cuadradas).

**Rebake completo de Vetrheim, promocionado y verificado en vivo de punta a punta (mismo día)**: 529.9s, "Validación: OK", determinismo confirmado (solo cambiaron los 20 sectores que tocan los 12 asentamientos, más terreno extramuros ahora libre gracias al bloqueo ajustado — antes 17 sectores con la caja completa bloqueada). Verificado con servidor+cliente+Playwright reales contra el mapa YA promocionado, junto al portal real de `capital_regional`: **bug real en el PROPIO script de verificación, no en el juego** — `window.__test.ultimoMensaje("portal:ir")` siempre da `null` aunque el portal funcione perfectamente, porque `"portal:ir"` tiene un handler DEDICADO en `client/src/game.ts` (`navegarA(...)`, casi siempre un reload de página hacia la nueva room) que nunca pasa por el `Map` genérico `ultimosMensajes` que sí trackea el resto de mensajes — la señal de éxito real es que la PÁGINA NAVEGA. Corregido el script de verificación para esperar la navegación en vez de leer ese Map (mismo falso negativo que ya había salido, sin diagnosticar, en una pasada anterior de esta sesión) — con la señal correcta, `portal:usar` confirma sin ambigüedad: la URL cambia a `?...&sala=region&mapaId=principal%2Fpois%2Fcapital_regional_1534_2138`, el log del servidor confirma `Región "capital-vetrheim-16:poi:capital_regional_1534_2138"... 81 NPCs... 12 animales`, y una captura tomada DENTRO de la instancia (tras esperar a que cargue) muestra NPCs reales con nombre propio caminando entre edificios reales — el ciclo completo puerta-real→portal→instancia funciona de verdad, no solo sobre el papel.

**Impresión visual honesta, actualizada**: sigue siendo arte voxel simple (no la fidelidad de las imágenes de referencia, que son renders de un juego con arte dedicado) pero ahora SÍ lee como una empalizada/muralla real con edificios apiñados dentro, no como piezas dispersas — mejora sustancial sobre §13/§13bis, techo real de lo alcanzable con el generador de cajas-por-vóxel de este proyecto sin invertir en un pipeline de arte más sofisticado. Captura de la silueta exterior tomada de noche (iluminación ambiental baja) — sin una captura equivalente de día en esta pasada, pendiente si el streamer quiere comparar mejor el contraste real del material/color.

### 13quater. v3: puerta snapeada a ángulo recto + portal pegado de verdad al hueco real (no a la caja delimitadora) — un segundo bug, más grave que la rotación, encontrado midiendo antes de tocar código (2026-09-09, misma noche, feedback streamer sobre las capturas de §13ter: "la puerta debe estar bien alineada y centrada que en una imagen esta girada... y que se entre y se salga solo por ahí, el resto tiene colisión")

El streamer aceptó el concepto de v2 ("esta era la idea sí") pero señaló que en una de las capturas la puerta salía girada, y pidió confirmar que solo se puede entrar/salir por ese punto (el resto de la muralla/edificios con colisión). Investigando el primer punto salió un segundo bug real, más grande, que la sola rotación no explicaba.

**Bug 1 — rotación en diagonal**: `roPuerta = puertaPrincipal.rotDeg` (v2) usaba la tangente EXACTA del polígono orgánico en ese punto, que puede ser cualquier ángulo — pero la muralla se dibuja siempre con bloques cúbicos alineados a ejes (el DSL de cajas de `generarSiluetaCiudad.js` no soporta rotación por caja), así que una puerta en un ángulo no recto choca visualmente contra un hueco recto. Arreglado snapeando al ángulo recto más cercano: `roPuerta = Math.round(puertaPrincipal.rotDeg / 90) * 90` (`baker/src/instanciasPOI.js`) — la pieza (`generar_puerta_asentamiento.js`) es simétrica bilateral Y longitudinalmente (confirmado revisando su geometría: espejo en X, idéntica en ambas caras Z), así que cualquiera de las 4 rectas encaja sin importar el signo real de la tangente.

**Bug 2, el real y más grave — el portal podía caer 15-24 casillas lejos de la puerta visual**: antes de tocar nada, se midió la distancia real entre cada `puerta_asentamiento` ya promocionada y su portal correspondiente (comparando datos ya horneados de `assets/mapas/principal/`, sin recomputar nada) — **5 a 24 casillas** de separación según el asentamiento, incluido el propio `capital_regional` verificado en vivo en §13ter (15.26 casillas: la verificación de esa pasada teletransportó al jugador directo a las coordenadas del portal, nunca comprobó que estuviera pegado a la puerta visible). Causa: el empuje de v2 salía de la CAJA DELIMITADORA rectangular del polígono de muralla (`huellaBloqueo`), no del polígono en sí — para un polígono irregular (Perlin), un punto cualquiera de su borde (la puerta) puede estar muy lejos del borde de SU PROPIA caja delimitadora en la dirección radial (la caja es más ancha que el polígono en casi todas las direcciones salvo las pocas más extremas) — confirmado con un caso real medido a mano: gate a distancia radial ~60 del centro del polígono, pero la caja delimitadora en esa dirección exigía viajar ~22 casillas más para salir de ella.

Arreglado sustituyendo la caja rectangular por el POLÍGONO REAL como criterio de bloqueo y de empuje — dos piezas:
1. **Bloqueo de terreno por polígono** (`poligonoBloqueo`, campo nuevo y opcional en `objetosPorPOI`, `baker/src/generar.js`): en vez de `xBloqueo`/`yBloqueo`/`huellaBloqueo` (rectángulo), un polígono en coordenadas MUNDO — el bucle de bloqueo hace point-in-polygon (`puntoEnPoligono`, ya existía en `ciudades/src/geometria.js`, reusado sin cambios) sobre cada casilla de la caja delimitadora del polígono, en vez de rellenar la caja entera. `colocarSiluetaYPuertaDeAsentamiento` pasa el polígono de muralla real, INFLADO ligeramente desde `ciudad.focal` (`MARGEN_MURO_BLOQUEO=2.5` casillas, más que el grosor real de la muralla en mundo a U=4, ~1.4-1.7 unidades) para cubrir el volumen visual de la muralla/torres.
2. **Empuje del portal por el mismo polígono**: en vez de un raycast analítico contra la caja (v2), un bucle que incrementa la distancia en pasos de 1 casilla desde un margen mínimo (1.5) hasta que `puntoEnPoligono` confirma que el punto ya cayó fuera del polígono inflado — el portal solo necesita salir del polígono REAL, nunca de una caja mucho más ancha en direcciones no radiales.

Medido el resultado antes de rebakear: la misma comprobación repetida en un bake de prueba (`ejemplo-rapido.json`, 3 campamentos hostiles) y en un sector aislado sintético (`client/test/generarSiluetaTestSector.js capital`) — distancia puerta↔portal de **2.8 a 4.0 casillas** (antes 5-24), y verificación visual (`siluetaAisladaCaptura.mjs`, nueva vista `vista=puertaiso`: mismo ángulo isométrico fijo del juego real, encuadrado sobre la puerta en vez del centro de la ciudad) confirma el marcador de posición del portal pegado justo al lado de la estructura de la puerta, ya no aislado en terreno vacío lejos del anillo.

**Segundo pedido del streamer, confirmado por diseño (no requirió cambio de código)**: "que se entre y se salga solo por ahí, el resto tiene colisión" — ya lo garantiza el mecanismo de bloqueo (ahora point-in-polygon en vez de rectángulo, pero el PRINCIPIO no cambia): toda casilla dentro del polígono inflado (la ciudad entera, muralla + interior) se marca `solar_edificio` (sólido, bloquea el paso), y el único punto navegable de entrada/salida es el portal, colocado siempre justo fuera de ese polígono en el hueco real de la puerta — no existe ningún otro hueco sin bloquear en el polígono salvo las puertas reales (que la propia silueta ya deja sin rasterizar, §13ter punto 1).

Verificado: `cd server && npm test` sin regresión, `ciudades/test/ciudad.test.js` 13/13, `taller-vox/test_edificio.js`+`test_hitos_plaza.js`+`test_pj.js`+`test_muebles_proporcion.js` 50/50, bake real de `ejemplo-rapido.json` (3 campamentos hostiles, todas las puertas con `ro` en {-90,90,180} y distancia puerta-portal 2.8-4.0), y verificación visual real (`siluetaAisladaCaptura.mjs` con la nueva vista `puertaiso`) para el tier `capital`.

**Rebake completo de Vetrheim con este fix, promocionado y verificado en vivo de punta a punta (mismo día)**: 741.6s, "Validación: OK", determinismo confirmado (17 archivos cambiados de la promoción anterior — `indice.json` + 16 sectores, exactamente los que tocan los 12 asentamientos con silueta civiles/hostiles; el resto de los 100 sectores byte a byte idéntico). Medido directamente sobre el mapa YA promocionado (`assets/mapas/principal/`): las 12 `puerta_asentamiento` reales tienen `ro` en {-90,0,90,180} (antes cualquier ángulo del polígono orgánico) y distancia puerta↔portal de **2.0 a 4.24 casillas** (antes 5-24, mismos 12 pares comparados). Verificado con servidor+cliente+Playwright reales contra `capital_regional`: una captura desde unos metros muestra la muralla/edificios reales junto al jugador con la puerta y el camino pavimentado visibles; `portal:usar` en el punto real del portal navega de verdad (URL cambia a `...pois/capital_regional_1534_2138`, log del servidor confirma la región con 81 NPCs), y la captura final dentro de la instancia muestra al jugador junto a NPCs reales con nombre propio caminando entre edificios. Único error de consola: el favicon 404 de siempre (inocuo, no relacionado). `output/vetrheim` limpiado tras la promoción.

### 13quinquies. v4: TODAS las puertas reales, no solo la principal — el bug que explicaba "veo el hueco pero no la puerta" (2026-09-10)

Pedido streamer, tras jugar sobre el mapa promocionado: *"aparece nada mas entrar hueco de puerta per no puerta para entrar a la ciudad"*.

**Investigado antes de tocar código**: `generarSiluetaCiudad.js` (§13ter) ya recortaba el hueco visual de la muralla en TODAS las `ciudad.puertas` reales (2-3 típicas por asentamiento — confirmado con `capital_regional`: 3 puertas físicas reales en `muralla.modulos`), pero `instanciasPOI.js::colocarSiluetaYPuertaDeAsentamiento` (§13/§13quater) solo colocaba el arco interactivo (`puerta_asentamiento`) y el portal en `puertaPrincipal` — `ciudad.puertas[0]`, la MÁS cercana al primer cruce de camino. Las otras 1-2 puertas quedaban con un hueco real en la muralla (nada bloqueando ahí visualmente) pero SIN arco ni portal — el jugador podía llegar caminando hasta ese hueco (el terreno de fuera es normal) y encontrarse con "el hueco está ahí pero no hay nada que cruzar".

**Confirmado con el algoritmo REAL de spawn** (`casillaPisableMasCercana`, anillos de Chebyshev desde `indice.ciudad`, simulado sobre el terreno baked de verdad de `capital_regional`): el punto de spawn caía a **~14 casillas de la puerta huérfana más cercana** (la que no tenía arco), frente a **~77 casillas** de la única puerta funcional — de ahí que el streamer viera el hueco casi al entrar, no la puerta que sí funcionaba (al otro lado de la ciudad).

**Arreglado extendiendo el mismo mecanismo a TODAS las puertas reales, no eligiendo "la más cercana al spawn"** (más robusto: no depende de dónde caiga el spawn en futuros rebakes, y da a un asentamiento amurallado real varias entradas, como cabría esperar): `generarSiluetaCiudad.js` devuelve ahora `puertas: [{x,y,rotDeg}, ...]` (todas, calculando el ángulo tangente de cada una igual que antes solo hacía para la principal — `puertaPrincipal` se conserva como alias de `puertas[0]`, retrocompatible). `colocarSiluetaYPuertaDeAsentamiento` itera esa lista completa: cada puerta real recibe su propio objeto `puerta_asentamiento` (`${slug}_puerta_${i}`, variante determinista distinta por índice) y su propio portal — TODOS con el mismo destino (`pois/${slug}`, es la misma ciudad, da igual por cuál se entre) — reusando el mismo empuje-hasta-salir-del-polígono real de §13quater para cada una, no solo para la principal.

Verificado: llamada real a `generarInstanciasPOI` con un POI sintético `capital_regional` — **3 puertas reales, 3 arcos, 3 portales**, cada uno a 2.0-3.6 casillas de su arco correspondiente (mismo orden de magnitud que §13quater). `cd server && npx tsc --noEmit` limpio, servidor 1311/1311, `ciudades/test/ciudad.test.js` 13/13, `taller-vox/test_edificio.js`+`test_hitos_plaza.js`+`test_pj.js`+`test_muebles_proporcion.js` 50/50 sin regresión, bake real de `ejemplo-rapido.json` (3 campamentos hostiles) colocando múltiples puertas por asentamiento sin errores.

**Rebake completo de Vetrheim con este fix, promocionado (590.2s, "Validación: OK — 69 POIs, 0 sin ruta")**: determinismo confirmado — solo 10 archivos cambiados (`indice.json` + 9 sectores, exactamente los que tocan asentamientos con 2+ puertas reales; el resto de los 100 sectores byte a byte idéntico). `puerta_asentamiento` en el mapa promocionado: **12 → 15** (3 asentamientos ganaron sus puertas adicionales; los que ya solo tenían 1 puerta real se quedaron exactamente igual, byte a byte). `capital_regional` pasó de 1 a 3 puertas/portales reales — el nuevo en `(1509,2098)`, a **~11.7 casillas del spawn real** (`1503.5,2102.5`), frente a las ~77 de la única puerta que existía antes. **Verificado en vivo de punta a punta** (servidor+cliente+Playwright reales sobre el mapa YA promocionado, login real de superadmin): teleport junto a la puerta nueva, `portal:usar` navega de verdad (URL cambia a `.../pois/capital_regional_1534_2138`, log del servidor confirma la región con 81 NPCs), captura final dentro de la instancia muestra al jugador junto a un NPC real con nombre propio entre edificios — el ciclo puerta-nueva→portal→instancia funciona igual que la principal. `output/vetrheim` limpiado tras la promoción.

## 14. Spawn del mapa = la PUERTA del asentamiento civil más cercano a `ciudad`, escrito por el bake (2026-09-10, playtest multijugador autónomo)

**Síntoma real**: en el playtest multijugador (`client/test/playtestMultijugador.e2e.mjs`, 4 clientes reales sobre `assets/mapas/principal/`) todos los jugadores nuevos aparecían en (1503.5,2102.5) — campo abierto, a ~80 casillas de la puerta real de `capital_regional`. No era un bug del servidor: `config.ciudad` (1534,2138) es el CENTRO de la capital, y desde §13quater toda la ciudad es un polígono `solar_edificio` sólido, así que `mapaColision.ts::casillaPisableMasCercana` (búsqueda por anillos desde el centro) se para en la primera casilla pisable que encuentra saliendo del polígono — que rara vez es la puerta, porque el polígono es orgánico y la puerta cae donde caiga el primer hueco real de la muralla (`ciudad.puertas[0]`). Ya se había apuntado como limitación en el bullet de despliegue de CLAUDE.md ("no queda pegado a la puerta porque el buscador solo acepta TIERRA").

**Arreglo, en dos capas y sin tocar el buscador**:
1. `baker/src/instanciasPOI.js` devuelve `entradasAsentamiento: [{poiX, poiY, x, y, hostil}]` — una entrada por asentamiento con silueta (civil u hostil), con la casilla exacta del portal exterior (la que §13quater ya garantiza pisable y pegada al hueco real de la muralla). `colocarSiluetaYPuertaDeAsentamiento` gana un 5º parámetro `hostil` (false en la rama civil, true en la rama de campamentos) solo para poder filtrar después.
2. `baker/src/generar.js` elige `spawn` = la PUERTA (portal exterior) de asentamiento NO hostil más cercana a `ciudad` — con varias puertas reales por asentamiento desde §13quinquies, gana la puerta concreta más cercana, no el centro del asentamiento, y lo escribe en el índice junto a `ciudad` (`exportador.finalizar({..., ciudad, spawn})`). `spawnEnPuerta: false` en el config lo desactiva (mapas de prueba que quieren aparecer literalmente en `ciudad`, p.ej. `testflat`). Sin ningún asentamiento civil en el mapa, `spawn` queda `null` y todo sigue como antes.
3. `server/src/mundo/mapaColision.ts`: `indice.spawn ?? indice.ciudad ?? centro` — `spawn` manda; el resto de la cadena (y la corrección a pisable) no cambia. Test dedicado: `server/test/mapaColisionSpawn.test.ts` (4 tests sobre un mapa minúsculo escrito en carpeta temporal — prioridad spawn>ciudad>centro y corrección a pisable si `spawn` cae en roca).

**Aplicado al mapa YA promocionado sin rebake**: `assets/mapas/principal/indice.json` gana `"spawn": {"x":1486,"y":2179}` — el portal real de `capital_regional` (el mismo que usa el propio playtest para cruzar la puerta con F). Verificado contra el cargador real del servidor (`cargarMapaColision`, no a ojo): `spawnX/Y = 1486.5, 2179.5`, distancia 0.0 al portal, casilla tipo TIERRA con el vecino norte sólido (la muralla) — exactamente "en la puerta". El próximo rebake de `vetrheim.json` lo regenera solo (mismo algoritmo, misma semilla ⇒ mismo portal), sin parche manual.

**Deuda ya conocida que esto NO toca**: la posición guardada por jugador (`pos_x/pos_y`, "mantener posición al F5") sigue mandando sobre el spawn para cualquier personaje que ya se conectó antes — solo los personajes nuevos aparecen en la puerta, comportamiento correcto y ya documentado en CLAUDE.md.
