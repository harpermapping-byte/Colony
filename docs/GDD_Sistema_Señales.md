# Sistema de señales de dirección en los caminos

Pedido streamer (2026-09-13): "faltaría añadir nombres a las ciudades aldeas o
POIS que se han generado en el mapa... para poner un sistema de SEÑALES en
los caminos que te indiquen hacia donde va ese camino... dando click sobre
el prop (un palo con una señal de dirección flecha) te dice hacia que POI
vas... cada camino tenga uno cada X espacio de camino, un prop de dirección
al borde". Léelo antes de tocar `baker/src/generar.js` (trazado de caminos),
`baker/src/instanciasPOI.js` (nombres de asentamiento) o
`client/src/game.ts` (etiquetas clicables de mundo).

## Dos piezas independientes

1. **Topónimos reales para asentamientos civiles** — cualquier "aldea"/
   "pueblo"/"capital"/"castillo" del mapa exterior (POI `categoria:
   "asentamiento"`, o una mazmorra `estiloExterior:"asentamiento"` SIN
   `hostil`) recibe un nombre de una lista curada por el streamer, en vez de
   quedarse con su id técnico de catálogo (`aldea_agricola`,
   `capital_regional`...). Los campamentos hostiles (bandidos/orcos/
   cultistas...) NUNCA reciben nombre propio — siguen con
   `nombreLegibleDesdeId(poi.id)` de siempre (p.ej. "Guarida Bandidos"),
   coherente con que no son asentamientos civiles reales.
2. **Señales de dirección** — un prop de madera (poste + tablón-flecha) cada
   cierto tramo de un camino que lleva a un asentamiento CON nombre propio,
   clicable: dice hacia qué asentamiento apunta.

## Catálogo de nombres — `baker/catalogo/nombresAsentamientos.json`

Lista de 50 topónimos reales dados por el streamer (Guarromán, Pepino,
Tembleque, Villapene...). `baker/src/instanciasPOI.js` baraja la lista UNA
VEZ por semilla de mundo (Fisher-Yates, `crearPRNG(semillaDesdeTexto(
"<semillaMundo>:nombresAsentamientos"))` — determinista, misma semilla =
mismo reparto) y asigna un nombre por asentamiento civil en el orden en que
`generarInstanciasPOI` los procesa. Si un mapa tuviera más asentamientos
civiles que nombres de la lista, cicla añadiendo un sufijo numérico en vez
de dejar alguno sin nombre (caso raro, ningún mapa real llega a 50
asentamientos civiles hoy).

El nombre asignado se propaga a:

- **`indice.json` del asentamiento anidado** (`ciudades/src/index.js::
  hornearCiudad`/`exportarCiudad` ganan un parámetro opcional
  `{nombreAsentamiento}` que sustituye el `nombre` por defecto
  `${tier}-${semilla}`) — usado ya por `panelMapaMundo.ts` (título "Mapa —
  <nombre>") y el log de `RegionRoom.ts` al cargar la región.
- **`nombreDestino` del/de los portal(es) "exterior"** de ese asentamiento
  en el `indice.json` del mapa PADRE (`colocarSiluetaYPuertaDeAsentamiento`)
  — la etiqueta clicable "Entrar <Nombre>" (docs/GDD_Sistema_Puertas.md,
  "puerta física clicable") ya muestra el topónimo real en vez del id.
- **`destino` de cada señal de dirección** — ver más abajo.

`nombreAsentamientoActual()` (`RegionRoom.ts`, usado por el panel de
inspección de NPC/ciudad, docs/GDD_Poblacion_NPCs.md) sigue usando
`nombreBonitoDeTier(this.tierAsentamiento)` (una etiqueta genérica del
TIER, "Aldea", "Capital Regional"...) — **a propósito sin tocar** en esta
pasada: es un campo distinto (qué TIPO de asentamiento es, no su nombre
propio) y cambiarlo no se pidió explícitamente.

## Señales — `baker/src/generar.js`

### Qué camino lleva señal

Durante el trazado de caminos (`if (ciudad) {...}`, mismo bucle que ya traza
la red de A*/Dijkstra reducido), cada vez que un camino se traza con éxito
se comprueba si su POI destino tiene un nombre propio asignado
(`nombresAsentamientos.get(slugPOI(poi))`) — si lo tiene, la polilínea CRUDA
del camino (los waypoints del A*/Dijkstra reducido, `pasoCaminos` en
`pasoCaminos` de separación real — ANTES de la ondulación cosmética de
`marcarSegmentoComoCamino`) se guarda en `caminosParaSenales` junto al
nombre. Los caminos a POI "edificio"/mazmorra (sin nombre propio) o los que
no encontraron ruta nunca entran aquí.

### Orientación del recorrido

`buscador.buscar()` (el PRIMER camino, sale de la ciudad) devuelve
`[ciudad...poi]`; `buscador.buscarHastaRed()` (el resto, salen del POI hacia
la red ya construida) devuelve `[poi...red]` — el orden CONTRARIO. Sin
normalizar esto, la mitad de las señales apuntarían en sentido opuesto al
real. Se detecta comparando qué extremo del array está más cerca del `poi`
(`distIni`/`distFin`) y se invierte una COPIA si hace falta, nunca el array
original (usado también por `marcarSegmentoComoCamino`).

### Colocación a lo largo del camino

Constantes (`generar.js`):

- `DISTANCIA_ENTRE_SENALES = 55` casillas — "cada X espacio", ni pegadas ni
  una sola por carretera larga.
- `MIN_LARGO_PARA_SENAL = 25` casillas — un camino más corto que esto (POI
  casi pegado a la red ya construida) no necesita ninguna señal.
- `OFFSET_BORDE_SENAL = 2.5` casillas perpendiculares al camino — despeja el
  ancho real de la calzada (`radioCaminoEn`, 1-3 casillas).

**BUG REAL #1, encontrado con un bake de prueba real (no a simple vista):**
con `MIN_LARGO_PARA_SENAL` (25) < `DISTANCIA_ENTRE_SENALES` (55) existía una
"zona muerta" — cualquier camino de largo 25-54 casillas pasaba el filtro de
"sí necesita señal" pero el bucle de colocación (que arrancaba SIEMPRE en
`d = DISTANCIA_ENTRE_SENALES`) nunca llegaba a ejecutarse ni una vez
(`55 < 45` es falso) — ese camino se quedaba sin NINGUNA señal pese a haber
pasado el propio filtro que decía que sí hacía falta una. Reproducido de
verdad generando un bake pequeño con dos aldeas civiles reales (caminos de
32 y 45 casillas, ambos por encima de `MIN_LARGO_PARA_SENAL` pero por debajo
de `DISTANCIA_ENTRE_SENALES`): `indice.senales` salía vacío del todo.
Arreglado garantizando AL MENOS una señal por camino que pase el filtro: el
primer punto de colocación es el MENOR entre la distancia de espaciado
normal y la mitad del camino total (`primerPunto = largoTotal <
DISTANCIA_ENTRE_SENALES ? largoTotal / 2 : DISTANCIA_ENTRE_SENALES`) — un
camino corto recibe una señal centrada, ni pegada a la red ni pegada a la
puerta del asentamiento.

**BUG REAL #2, encontrado verificando con `admin:debug:teleport` real, no
solo leyendo el JSON generado:** el nudge perpendicular que empuja la señal
al borde del camino solo evitaba caer literalmente SOBRE la calzada
(`tilesCaminoRoad`) — nunca comprobaba si el punto de destino era agua o
roca impasable. Un camino que bordea un lago (frecuente: los caminos rodean
lagos/ríos reales) podía empujar la señal DENTRO del lago. Confirmado con un
caso real: `admin:debug:teleport` a la posición exacta de una señal saltó al
jugador ~24 casillas más allá buscando la tierra firme más cercana — la
señal literalmente flotaba sobre agua. Arreglado con `bloqueadaParaSenal(x,
y)`, reusando las MISMAS comprobaciones que ya descarta `costoArista` al
trazar el propio camino (lago, río, banda de roca 6) — el nudge prueba hasta
5 offsets crecientes a AMBOS lados del camino (`[lado, -lado]`) y, si ningún
punto libre aparece a ningún lado, esa señal concreta se omite (mejor sin
señal que clavada en agua).

**BUG REAL #3, mismo mecanismo de verificación, encontrado DESPUÉS de
arreglar el #2:** incluso en tierra firme, un camino CORTO (25-54 casillas)
puede caer ENTERO dentro de la propia silueta sólida del asentamiento — la
ruta A* traza hasta el CENTRO del POI (`poi.x, poi.y`), no hasta su puerta
real, y el centro de un pueblo/aldea está rodeado de terreno sólido (muralla
+ edificios) en un radio que puede superar la mitad del camino total.
Reproducido con el mismo caso real del bug #2 tras arreglarlo: el punto
"medio" del camino seguía cayendo dentro de la muralla (terreno 100% sólido
en un radio de 15+ casillas alrededor). Arreglado con
`radioSeguridadAsentamiento` (Map `"poiX_poiY" -> radio`, calculado UNA vez
a partir de `entradasAsentamiento` — la distancia real centro→puerta de CADA
asentamiento, ya calculada por `instanciasPOI.js` con el polígono real de la
muralla) — cualquier punto candidato de la polilínea a menos de
`radioSeguridadAsentamiento + MARGEN_SEGURIDAD_ASENTAMIENTO` (4 casillas) de
su propio POI se descarta, buscando el siguiente `d` del bucle.

Con los tres arreglos, un asentamiento cuyo camino de acceso sea
íntegramente corto (dentro de la propia muralla + margen de seguridad, sin
tramo libre real) simplemente NO recibe señal — correcto: no hay sitio real
donde ponerla.

### Rotación y variante

`ro = Math.atan2(dy, dx) * 180 / PI` — MISMA convención ya verificada
funcionando para los módulos de muralla (`ciudades/src/generar.js`), no una
convención nueva inventada para esta pieza. `va` (0-2, 3 variantes reales)
por hash determinista de `${semilla}:senal:${poi.id}:${indiceSenalGlobal}`.

### Formato de salida

Cada señal colocada produce DOS cosas independientes:

1. **Objeto visual** `{i:"senal_camino", t:"m", va, ro, es:1, x, y}`
   (coordenadas LOCALES de chunk) fusionado en `edificiosPOIPorChunk` —
   exactamente como cualquier otra pieza de decoración urbana/hitos de
   plaza. `sectorVisual.ts` ya prueba genéricamente
   `assets/interiores/senal_camino_0{1,2,3}.glb` para categoría `"m"`, cero
   cambio de cliente para la parte puramente visual.
2. **Entrada en `indice.senales`** (coordenadas de MUNDO, no de chunk):
   `{x, y, destino}` — el `destino` es el topónimo real
   ("Parderrubias", "Guarromán"...). Esto es lo que consume el CLIC.

## Modelo 3D — `taller-vox/generar_senal_camino.js`

Mismo patrón que `generar_puerta_asentamiento.js`/`generar_hitos_plaza.js`
(Builder/sombrear/PRNG propios, sin pasar por `generar_modelos.js` — ese
archivo ejecuta su generación completa al importarse, no es una librería).
3 variantes exportadas a `assets/interiores/senal_camino_0{1,2,3}.glb` con
`--centrar-xz` (enganche rápido, mismo criterio ya usado repetidas veces
para lotes de arte procedural de esta sesión — subido directo sin revisión
pieza a pieza).

Geometría: poste vertical (1.7-2.0 casillas de alto, por encima del jugador
y de la vegetación) + un tablón-flecha que nace pegado al poste en +X local
(rotación 0° = "la flecha señala +X del mundo") con una punta triangular
aproximada por capas de altura decreciente. Variante 2/3 añaden una muesca
corta en el lado opuesto (contrapeso visual, como un cartel real con dos
brazos desiguales) y madera más oscura.

**BUG REAL de anclaje, encontrado MIDIENDO el bbox exportado (no a ojo)
antes de subir nada:** la primera versión declaraba `grid: [anchoTotal,
altoPoste, U]` donde `anchoTotal` incluía el LARGO del tablón — como
`--centrar-xz` centra usando `grid[0]/2`, esto habría anclado el modelo en
el centro de masa del BRAZO (que no es donde está el poste), desplazando el
punto de anclaje real (la base del poste, donde cae la señal en el mapa y
la etiqueta clicable) varias décimas de casilla — mismo tipo de bug
"esquina-vs-centro" ya documentado varias veces en
`docs/GDD_Bakeador_POIs.md`. Arreglado declarando `grid: [U, altoPoste, U]`
(la huella NOMINAL de una sola casilla, ya que `exportar_glb.js` nunca usa
`grid` para recortar geometría — solo para el offset de centrado) —
verificado con `validar_glb.js` que el bbox exportado queda anclado en la
base del poste (`min.x` cerca de 0, no desplazado hacia el tablón).

**BUG REAL visual, encontrado con una captura y corregido tras feedback
directo del streamer** ("la señal sale como una bandeja, debería ser
vertical no?"): la primera versión hacía el tablón FINO en Y (vertical,
`grosorTablon`) y ANCHO en Z (perpendicular al camino) — se veía como una
bandeja/repisa horizontal tumbada en vez de un cartel de pie. Arreglado
intercambiando qué eje lleva la altura real (`altoTablon`, eje Y) y cuál es
el grosor fino de canto (`grosorTablon`, eje Z) — re-verificado con
capturas Playwright frescas mostrando un tablón vertical con una punta de
flecha reconocible antes de subir el `.glb` final.

## Cliente — `client/src/game.ts`

Mismo patrón EXACTO ya probado y verificado para las puertas de asentamiento
clicables ("Entrar <Nombre>", docs/GDD_Sistema_Puertas.md): una etiqueta
CSS2D creada OCULTA por `WorldScene.añadirEtiquetaInteractiva`, mostrada/
ocultada a ritmo bajo (400ms, mismo criterio que `hintAsiento`/portales) por
distancia real al jugador vía `WorldScene.mostrarEtiquetaInteractiva`
(`div.style.visibility`, nunca `display` ni `object.visible` — ver los dos
bugs de `CSS2DRenderer` ya documentados en `docs/GDD_Sistema_Puertas.md`).

Diferencia real con el patrón de puertas: **sin ningún mensaje al
servidor**. El destino ya viaja completo y estático en el propio bake
(`indice.senales`), así que el clic solo muestra un toast local
(`registroCombate.mostrar("El camino lleva hacia <Nombre>.", "info")`) — no
hace falta ida y vuelta de red para algo que no cambia nunca en la sesión.

`indice.senales` es opcional (`SenalCamino[]`, `client/src/mapa/
formatoMapa.ts`): un mapa horneado ANTES de esta fecha (`assets/mapas/
principal/` hasta su próximo rebake) simplemente no trae el campo, sin
ningún cambio de comportamiento — cero etiquetas, cero error.

`RADIO_LECTURA_SENAL_CLIENTE = 3` casillas (un poco más generoso que
`RADIO_ENTRADA_PORTAL_CLIENTE = 2.2` de las puertas — leer una señal es solo
informativo, sin gate de servidor, así que no hace falta ser tan estricto
con la distancia).

## Verificación

- Llamada real a `generarInstanciasPOI` con 2 POIs sintéticos de
  asentamiento civil (misma semilla de mundo, distinto tier) confirma
  nombres asignados de la lista real y `nombreDestino` de AMBOS portales de
  cada asentamiento (una aldea puede tener varias puertas reales, ver
  `docs/GDD_Bakeador_POIs.md` §13quinquies) coincidiendo con el nombre
  propio, nunca el id técnico.
- Bake real pequeño (`baker/config/ejemplo-rapido.json`, semilla "prueba-13"
  — elegida tras un barrido de 8 semillas candidatas, la mayoría de aldeas
  en un mapa de prueba minúsculo quedan demasiado cerca de la red para
  superar el radio de seguridad de su propia muralla) coloca 1 señal real,
  verificada con el cargador de colisión REAL del servidor
  (`cargarMapaColision`/`medioEn`) como terreno walkable, no agua/roca.
- `cd client && npx tsc --noEmit` limpio, `npx tsx --test test/*.test.ts`
  148/148 sin regresión.
- **E2E visual real** (`client/test/senalCaminoClicable.e2e.cjs`, servidor+
  Vite+Playwright reales, mismo patrón que
  `puertaFisicaClicable.e2e.cjs`): bakea el mapa de prueba EN PROCESO,
  confirma la etiqueta oculta lejos / visible cerca (con reintento real
  contra el DOM, no una espera fija — ver el propio archivo para la
  explicación de por qué un `esperar(ms)` fijo puede caer en un instante
  transitorio real entre el intervalo de 400ms y el render por frame de
  `CSS2DRenderer`), un CLIC real en coordenadas de pantalla reales
  (`page.mouse.click`, nunca invocando el handler a mano), y el toast final
  con el nombre real del destino — sin ningún error de consola/página.

## Pendiente real

- Sin verificación en el mapa principal en vivo (`assets/mapas/principal/`
  necesita un rebake completo para llevar nombres+señales — no se rehorneó
  en esta pasada, decisión del streamer, mismo criterio que otros cambios
  de bakeador de esta sesión).
- `nombreAsentamientoActual()` (`RegionRoom.ts`, panel de inspección de
  NPC/ciudad) sigue mostrando el TIER genérico, no el topónimo propio — no
  pedido explícitamente, posible ampliación futura si el streamer lo quiere
  coherente.
- Los portales `tipo:"interior"` (edificio/mazmorra sueltos) no tienen
  concepto de "camino con nombre" — solo asentamientos civiles reciben
  señales, por diseño.
