# Motor 3D de props/objetos/personajes — decisión y estado

Documento de referencia para no perder ni repetir esta decisión. **Léelo antes de tocar el render del cliente o de crear un catálogo/carpeta de assets nueva.**

## Decisión (confirmada con el streamer)

El juego es 2.5D estilo Project Zomboid. En vez de dibujar sprites por dirección (izquierda/derecha/arriba/abajo) de cada personaje/mueble/árbol/planta/roca/animal, **todo eso pasa a ser un modelo 3D real de vóxeles**, cargado en una escena con cámara ortográfica isométrica — la geometría gira de verdad, no hace falta un sprite por ángulo.

**Qué se queda en 2D a propósito**: el suelo/terreno (`assets/terrenos/`, tileset de texturas) y el mapa en sí. Nunca pasa a vóxel.

**Qué pasa a 3D**: props/decoración de exteriores (árboles, plantas, rocas), fauna, mobiliario/objetos de interiores, personajes (jugadores/NPCs), y en el futuro armas — cualquier cosa que no sea el fondo/mapa.

## Cómo se generan los modelos

Con el taller de vóxeles (`taller-vox/` — generadores de muebles, personajes, NATURALEZA y EDIFICIOS + exportadores `.glb`, ver su README) exportas un `.glb` por pieza. Lo guardas en el sitio que le toca según la convención de abajo y el motor lo recoge solo, sin tocar código.

Reparto pactado con el streamer: **lo que tiene esqueleto** (PJs, NPCs, fauna, insectos) sale del creador de personajes (`personajes/`, 7 plantillas de esqueleto — ver GDD_Generador_Personajes); **lo que NO tiene esqueleto** (árboles, plantas, setas, rocas, menas, cristales... además de los muebles de siempre) sale del taller (`taller-vox/generar_naturaleza.js`, 14 arquetipos leyendo los catálogos reales del baker).

## Convención de assets — SIN catálogo nuevo

Importante: **no se creó ningún catálogo de datos nuevo**. Los catálogos que ya existían (`baker/catalogo/*.json`, `interiores/catalogo/elementos.json`) ya traían todo lo necesario — `variantes` (o `variantesNombradas`) y `colorDebug` — pensado en su día para placeholders 2D, y se reutiliza tal cual para 3D. Solo cambia la extensión de archivo que se busca.

```
assets/<categoria>/<id>_<NN>.glb        variante numerada (NN = 01, 02... según el campo "variantes" del catálogo)
assets/<categoria>/<variantId>.glb      variante con nombre propio (ej. variantesNombradas: "mesa_comedor_roble")
```

Mismo árbol de carpetas que ya documentaba `assets/README.md` para los PNG (`vegetacion/`, `animales/`, `rocas/`) — la única categoría nueva es `personajes/` (jugadores/NPCs, sin catálogo de datos propio todavía, ver pendientes) e `interiores/` (mobiliario/objetos de `interiores/catalogo/elementos.json`, que hasta ahora no tenía ninguna carpeta de assets). `edificios/` (la masa exterior de cada `tipoEdificio` que coloca `ciudades/`, `taller-vox/generar_edificio.js`) es otra categoría nueva más: `assets/edificios/<tipoEdificioId>_<NN>.glb`.

**Placeholder mientras no existe el `.glb`**: un cubo de color usando el `colorDebug` que ya trae cada entrada del catálogo — no un campo nuevo, no una imagen nueva. Ver `client/src/render3d/placeholder.ts`.

Los PNG existentes en `assets/vegetacion/`, `assets/animales/`, `assets/rocas/` (placeholders 2D generados por `baker/src/generar_placeholders.js`) **quedan como referencia obsoleta** — el motor 3D nunca los lee. No se han borrado por si sirven de referencia visual al generar los `.glb` equivalentes; se pueden limpiar más adelante cuando cada categoría tenga ya su `.glb`.

## Qué se implementó ya (motor base, `client/`)

- Cliente migrado de **Phaser 3 (sprites 2D) a Three.js** (`client/package.json`) — Phaser se ha quitado del todo, no coexisten los dos motores.
- `client/src/render3d/worldScene.ts` — escena con cámara ortográfica isométrica, luces, suelo placeholder plano, y una cámara que sigue al jugador local (`seguirPunto`).
- `client/src/render3d/assetCatalog.ts` — resuelve `categoria + id + variante → URL del .glb` siguiendo la convención de arriba.
- `client/src/render3d/entityLoader.ts` — carga el `.glb` con `GLTFLoader`, cachea la plantilla por URL, y si falla (404, todavía no generado) cae a un cubo `colorDebug` sin romper nada. Cada instancia nueva es un `.clone()` de la plantilla ya cargada, no una carga de red por instancia.
- `client/src/render3d/placeholder.ts` — el cubo de color, anclado por la base (mismo criterio de anclaje que el resto del proyecto).
- `client/src/game.ts` — sustituye a la antigua `MainScene` de Phaser: misma lógica de red con Colyseus (sala `hub`, mensaje `"input"` con `{x,y}`), ahora dibuja cada jugador como entidad 3D en vez de sprite.
- `client/vite.config.ts` — sirve `assets/` (que vive en la raíz del repo, no dentro de `client/`) en `/assets` tanto en desarrollo como en el build de producción (`dist/assets/`), sin depender de ningún paquete nuevo. El bundle propio de Vite se mueve a `dist/_bundle/` para no mezclarse ni pisarse con la copia de `assets/`.
- Probado de punta a punta con un servidor+cliente reales corriendo: el jugador aparece como cubo 3D con volumen, gira la cámara isométrica correctamente, la etiqueta de nombre funciona, y el fallback a placeholder ante un `.glb` inexistente no rompe nada (solo un 404 esperado en consola).

## Segunda pasada (consumo de bakeados + rig animado, sobre la base anterior)

- **Consumo real del bakeador de exteriores** — el cliente carga un mapa bakeado y materializa EXACTAMENTE lo que dice, sin decidir nada nuevo (misma filosofía "generar una vez"):
  - `client/src/mapa/formatoMapa.ts` — tipos + decodificación del formato de `baker/src/exportar.js` (que sigue siendo la única fuente de verdad del formato; si cambia allí, este es el ÚNICO archivo del cliente a tocar). Terreno: un carácter base36 por casilla → índice en `leyendaTerreno` del `indice.json`.
  - `client/src/mapa/cargarMapa.ts` — fetch de `indice.json` + todos los `sector_XXX_YYY.json`. Para el mapa demo se cargan todos de golpe; la interfaz ya permite carga perezosa por cercanía cuando llegue el mapa grande (cada sector es un fetch independiente).
  - `client/src/render3d/terreno.ts` — el suelo real: UNA textura-canvas con 1 píxel por casilla (`NearestFilter` → tiles nítidos) pintada con el `colorDebug` de `baker/catalogo/terrenos.json`; un plano, un draw call. Cuando exista el tileset de arte, se pinta con esos tiles en esta misma textura sin tocar nada más.
  - `client/src/render3d/propsBakeados.ts` — vegetación/rocas/fauna del bake instanciadas en sus casillas con su rotación/escala/variante. **Instancing real**: agrupadas por especie, y cada especie sin `.glb` se pinta con UN `InstancedMesh` (una llamada de dibujado por especie, iguales 3 que 3.000 árboles). Si la especie ya tiene `.glb`, sus instancias son clones de la plantilla cacheada.
  - `client/src/render3d/catalogoVisual.ts` — colores y dimensiones de placeholder consultando los catálogos REALES del bakeador (importa `baker/catalogo/*.json` al bundle) — cero tablas duplicadas a mano; magenta = id sin entrada de catálogo, para que un descuadre cante a la vista.
  - **Mapa demo commiteado en `assets/mapas/demo/`** (48x48, pradera+bosque, 32KB) — bakeado con el bakeador real (`baker/src/index.js`), así el cliente arranca enseñando mundo de verdad sin pasos manuales. Los mapas grandes siguen en `baker/output/` (gitignored) como siempre.
- **Rig humanoide animado** (`client/src/render3d/rigHumanoide.ts`) — personajes con esqueleto básico estilo Roblox/Minecraft: 6 piezas (cabeza, torso, brazo izq/der, pierna izq/der) colgando cada una de su pivote (cuello/hombros/caderas); animar = rotar pivotes. Ciclo de andar (zancada con brazos en contrafase, rebote sutil) y respiración en parado, con rampa de mezcla para no cortar en seco. El personaje encara la dirección de movimiento. **La cara es geometría, no textura**: ojos y nariz como piezas propias sobre la cara frontal — legible en isométrico y preparado para que el futuro creador de personajes varíe cada rasgo por separado. La futura ropa/pelo/accesorios se cuelga del pivote de la parte del cuerpo que le toque y hereda las animaciones gratis. Cuando exista el modelo vóxel real de personaje, mantiene esta MISMA estructura de pivotes y solo cambia la geometría de cada pieza.
- **Interpolación de red** (`client/src/game.ts`) — los patches del servidor llegan 15 veces/seg (decisión de plan gratuito); dibujar cada patch tal cual daba movimiento a saltos. Ahora cada jugador dibujado PERSIGUE su posición de servidor (lerp exponencial por frame), la animación de andar se activa por movimiento real, y la cámara persigue igual de suave al jugador local (`WorldScene.actualizar(dt)`).
- **Bug arreglado en `entityLoader`**: el placeholder se cacheaba por URL con el color del PRIMER solicitante — todos los jugadores remotos salían del color del jugador local. Ahora el cache solo guarda plantillas `.glb` reales (o el `null` de "no existe"); el placeholder se construye por petición con el color/dimensiones de cada solicitante. Nueva API `obtenerPlantilla()` para quien necesite la plantilla compartida (instancing de props).
- Cliente a pantalla completa (el 800x600 fijo era herencia del canvas de Phaser); luz direccional con cámara de sombra abierta al mapa entero (la caja por defecto de ±5 unidades recortaba las sombras).
- Probado de punta a punta con servidor + DOS clientes reales (Playwright): terreno y props bakeados visibles en sus casillas, ambos jugadores como rigs animados con su color correcto (local naranja, remoto turquesa — el bug del cache habría pintado los dos de naranja), movimiento sincronizado entre pestañas y sin errores de consola más allá del 404 esperado de la sonda de `.glb`.

## Tercera pasada: streaming de sectores — LA mecánica de carga del mapa principal

Pactada con el streamer como mecánica principal y definitiva: el mapa principal (`assets/mapas/principal/`, 100x100 chunks = 3200x3200 casillas, 100 sectores de ~1MB, 734.596 props) **nunca se carga entero** — solo se materializa el anillo alrededor del jugador y se suelta lo que queda atrás.

Cómo funciona (números con el mapa real):

- **Unidad de carga: el sector** (320x320 casillas, ~1MB JSON, ~7.300 props de media). Cada sector ya era un fetch independiente; no se tocó el formato del bake.
- **Radios en casillas al RECTÁNGULO del sector** (Chebyshev), no índices de sector: se materializa a ≤192 casillas y se suelta a ≥352. El hueco entre ambos (160 = medio sector) es la **histéresis** — pasearse por una frontera no carga/suelta en bucle (probado). En el centro de un sector eso da el anillo 3x3 (9 sectores, ~66k instancias); el pico transitorio cruzando fronteras queda ≤12.
- **El prefetch es el propio anillo**: al acercarte a una frontera, la fila siguiente entra en radio y se pide en segundo plano; cuando la cruzas ya está materializada (a 3,75 casillas/seg hay ~85 seg por sector — sobra margen).
- **Caché LRU de JSON parseado** (25 sectores) separada de lo materializado: volver sobre tus pasos re-materializa de caché sin refetch (probado).
- **Implementación**: `client/src/mapa/streamingSectores.ts` (SOLO la lógica — fetch y escena entran inyectados, así se prueba en Node sin navegador), `client/src/render3d/sectorVisual.ts` (terreno como plano+canvas de 320px POR SECTOR y props instanciados por especie×sector; al soltar se hace `dispose()` real de geometrías/materiales/texturas propias — los clones de plantillas `.glb` compartidas NO se dispose-an, solo se quitan de escena), `game.ts` enchufa ambos y llama `streaming.actualizar()` con la posición del jugador local (barato: solo reevalúa tras moverse 16 casillas). Sustituyen a `terreno.ts`/`propsBakeados.ts` (borrados — su código vive reorganizado en `sectorVisual.ts`).
- **Luz y suelo de emergencia siguen a la cámara** (`worldScene.ts`): caja de sombra de ±48 unidades centrada en el objetivo de cámara — en un mapa de 3200 casillas no existe "sombra global".
- **Spawn en la ciudad**: el servidor lee `indice.json` del mapa principal al arrancar (solo el índice, 1KB — nunca los sectores) y de ahí saca límites del mundo (102400x102400 px) y spawn (`ciudad` 1600,1600 → juntura de 4 sectores: el anillo inicial son esos 4). Sin índice (entorno raro) cae a los límites antiguos de prueba sin tumbar el servidor.

Probado: suite Node `node --import tsx --test client/test/streaming.test.ts` (7 tests: anillo 3x3, recorte en bordes, histéresis en frontera, caminata de 3200 casillas con pico ≤12 y liberación de lo dejado atrás, vuelta sin refetch, fetch único por sector) y e2e real `client/test/streaming.e2e.cjs` (servidor+vite+Playwright sobre el mapa principal: spawn en la ciudad con sus 4 sectores exactos materializados, captura del jugador sobre el camino de la ciudad, cero errores de consola).

## Herramienta de vóxeles para ítems de inventario (armas/herramientas/objetos/comida) — 2026-09-01

Pedido explícito del streamer: armas/herramientas/objetos/comida (`items/catalogo/items.json`) seguían siendo placeholders planos (cubo de `colorDebug`), a diferencia de mueble/edificio/naturaleza/ropa que ya tienen generador de vóxeles real. **Esto construye LA HERRAMIENTA** (arquetipos + mecanismo de variación + exportador), exactamente con el mismo patrón que `taller-vox/generar_modelos.js`/`generar_edificio.js` — el bakeo de producción real (generar+aprobar los `.glb` finales de los 195 ids y subirlos a `assets/`) lo lanza el streamer cuando decida ("los bakes grandes/de producción los corre el usuario", CLAUDE.md); esta pasada solo prueba la herramienta con una muestra pequeña (`--muestra` en cada script, ~7-8 ids por categoría) y no deja ningún `.glb` preparado.

**Archivos**: `taller-vox/itemsComun.js` (Builder/sombrear/PRNG compartidos, igual convenio de vóxel que el resto del taller, U=12 subdivisiones/casilla — más fino que muebles porque son piezas de mano) + un generador por tipo de catálogo:

- `taller-vox/generar_armas.js` — 19 ids (`tipo:"arma"`). 7 arquetipos por silueta: FILO (daga/espada corta/espada larga: pomo+mango+guarda+hoja ahusada en 2 escalones), HACHA, MAZA (cabeza con 4 aletas radiales), LANZA (asta+punta triangular), ARCO (corto/largo: vara curva por escalones desplazados en z, misma técnica que el atril de `generar_modelos.js`, + cuerda), HONDA (bolsa de cuero + cordones), BALLESTA (culata+arco corto atravesado+gatillo).
- `taller-vox/generar_herramientas.js` — 70 ids (`tipo:"herramienta"`). 11 arquetipos "mango+cabeza de trabajo" (HACHA/PICO/MARTILLO/TENAZAS/TIJERAS/CUCHILLO/VARA/AGUJA/PRECISION/RECIPIENTE/ANTORCHA) + `GENERICO` de reserva; solo 8/70 ids (11%) caen al fallback genérico — el resto clasifica por prefijo real del id.
- `taller-vox/generar_objetos.js` — 75 ids (`tipo:"objeto"`), el catálogo más heterogéneo. 11 arquetipos (VASIJA, SARTEN, PLANO —libro/pergamino/dados/cartas/moneda/reliquia—, ILUMINACION, HIGIENE, CONTENEDOR, SACO, MONTURA, HERBOLARIO, HERRAMIENTA_MESA, CUCHILLO_MESA) cubren 38 ids reales + reutiliza el arquetipo CUCHILLO de `generar_herramientas.js` y MARTILLO/TENAZAS para los homónimos de mesa (martillo/tenazas/herradura/clavos), sin duplicar geometría. Los 4 `barco_*` NO se generan aquí — ya los cubre `taller-vox/generar_barco.js`, evita duplicar. **Los 33 ids `cadaver_*` quedan explícitamente SIN COBERTURA** (`generarObjeto()` devuelve `null`): son restos de caza/pesca de géneros muy variados sin silueta común razonable con el resto de objetos — se deja su placeholder actual en vez de forzar un arquetipo malo, tal como permite el pedido original. Si en el futuro se quiere dar vóxel real a los cadáveres, hace falta un arquetipo propio (no encaja en ninguno de los de aquí).
- `taller-vox/generar_comida.js` — 31 ids (`tipo:"consumible"`). 7 arquetipos simples (PLATO —asados/cocinados, comida sobre un plato—, PAN, BEBIDA, FRASCO, VENDAJE —venda/tablilla/prótesis—, BLOQUE —queso/mantequilla—, RACION), sin el detalle de un arma (no hacía falta, pedido explícito).

**Mecanismo de variación** (mismo criterio que `resolverVariante()` de `generar_modelos.js`): el color sale SIEMPRE de `colorDebug`, el campo ya estructurado del catálogo — nunca inventado. Cuando el catálogo distingue tamaño/silueta de forma estructurada (`huella`, p.ej. `daga` [1,1] corta vs `lanza` [1,3] larga) se usa ESE dato para escalar longitud/arquetipo; el vocabulario de prefijo del id (`hacha_`, `pico_`, `cuchillo_`...) solo entra para elegir SILUETA cuando el catálogo no trae un campo estructurado para eso (`familiaMaterial` en herramientas es el OFICIO, no un material — no sirve para eso). Las variantes `_bonificada`/`_bonificado` comparten `colorDebug`/`huella` EXACTOS con su base en el catálogo (nota propia del catálogo: "mismo aspecto") — el generador no tiene ningún caso especial para eso, es consecuencia natural de leer esos campos (test `armas: '_bonificada' comparte aspecto EXACTO con su base` en `test_items.js`).

**Exportación**: cada generador produce el mismo formato `{grid, paleta, cajas, resolucion}` que mueble/edificio/naturaleza — `taller-vox/exportar_glb.js` (greedy meshing, sin librerías) los convierte a `.glb` real sin cambios; probado con una muestra de 28 ids exportados a `output/items_muestra_glb/` (gitignored, no commiteado). Cuando el streamer decida lanzar el bakeo real: `node generar_armas.js && node generar_herramientas.js && node generar_objetos.js && node generar_comida.js` (sin `--muestra`) generan los 4 JSON completos, y `exportar_lote.js <json> assets/<categoria>/` los exporta — falta solo revisar en el visor y aprobar antes de subir (flujo de aprobación del CLAUDE.md).

**Armas y herramientas ya bakeadas y consumidas de verdad (2026-09-08)** — cierra el "SIN CONSUMIDOR" que documentaba esta sección desde el día 1: `generar_herramientas.js` (71 ids) y `generar_armas.js` (45 ids) exportados a `assets/herramientas/` y `assets/armas/` (mismo "enganche rápido" sin revisión pieza a pieza, precedente ya aceptado por el streamer con el lote de edificios), y `client/src/render3d/equipoVisual.ts` gana un camino que intenta cargar el `.glb` real ANTES de la caja de `equipo.json` para los dos slots de mano (`manoPrincipal`/`manoSecundaria` — únicos slots donde "verse en la mano" era el pedido literal). ~~Objetos/comida (`generar_objetos.js`/`generar_comida.js`) siguen SIN generar/exportar~~ **Objetos exportados el 2026-09-11** a `assets/objetos/` (138 `.glb`, categoría nueva `"objetos"` de `assetCatalog.ts`: los 75 objetos de siempre + pociones/joyas/piezas de armadura/libros con 3 arquetipos nuevos FRASCO/JOYA/ARMADURA) — consumidos por los EXPOSITORES del carpintero (`docs/GDD_Construccion.md` §9.7), no por lo equipado. Comida sigue sin exportar. Detalle completo del enganche de cliente en `docs/GDD_Inventario.md` §12ter.

**Prueba visual**: `taller-vox/prueba_render_items.js` dibuja una galería SVG isométrica (mismo mini-render que `personajes/src/renderIso.js`) de la muestra de las 4 categorías → `output/galeria_items_muestra.svg` (+ `.png` vía Playwright, mismo patrón que `prueba_render_naturaleza.js`).

**Tests**: `taller-vox/test_items.js` (`node --test test_items.js`, 16 tests) — clasificación sin arquetipo faltante para el catálogo real completo (19+70+75+31 ids), geometría válida (cajas no vacías, paleta no vacía, grid positivo) para TODOS los ids reales de las 4 categorías (barato: solo cálculo en memoria, no exporta nada), determinismo por id, longitud creciente con `huella`, cobertura de objetos documentada (SIN_COBERTURA/BARCO), y exportación `.glb` real de una muestra de 4 ids (uno por categoría) verificando la cabecera binaria `glTF`.

## Muebles de interiores: proporción y colisión corregidas en el generador (2026-09-06, código listo, `assets/` pendiente de que lo aplique el streamer)

Pedido del streamer jugando de verdad ("las sillas son GIGANTES, la cama y
mesa ENORMES en proporción a los NPC... las colisiones deben adecuarse...
que ahora chocas con la cama en una zona que no hay cama"): dos bugs reales
y distintos en `taller-vox/generar_modelos.js`/`exportar_glb.js`, verificados
con números (no solo a ojo) antes de tocar nada:

1. **Alturas irreales**: `generarAsiento`/`generarMesa`/`generarCama` fijaban
   la altura en CASILLAS DE MUNDO directamente como si fueran metros — una
   `silla` salía a 2.3 unidades de alto (medido de verdad exportando el
   `.glb`: 2.29u) contra ~1.57u de una persona de pie (`altoPierna+
   altoTorso+ladoCabeza` de `proporcionesRig.json`) — un 46% MÁS ALTA que
   quien se sienta en ella. Mesas a 1.9u (casi la altura de un NPC) y camas
   con postes de cabecero a 1.5u (por encima del pecho de pie). Recalibrado
   a alturas reales: silla/banco/taburete 0.85u, mecedora/reclinatorio
   0.95u, trono 1.3u (ornamental, sale ~1.6u con el pico decorativo, sigue
   siendo el asiento más alto a propósito), mesa/escritorio/mostrador 0.75u,
   yunque 0.8u, cama 0.8u (con postes/dosel modestos, no un dosel de cuatro
   postes de palacio). Verificado con captura real junto a una caja del
   tamaño exacto del rig (`taller-vox/prueba_render_proporciones.js`) — las
   proporciones ya se leen como muebles normales junto a una persona.
2. **Colisión desalineada del modelo visual**: `exportarModelo` (el
   mesher de vóxeles) sacaba SIEMPRE el `.glb` anclado por la ESQUINA
   (0,0,0) — confirmado midiendo la caja delimitadora real del glTF
   exportado (`accessors[0].min/max`), no asumido. Pero TODOS los
   consumidores reales (`client/src/render3d/interiorVisual.ts`,
   `client/src/construccion/renderConstrucciones.ts`) colocan el modelo con
   `position.set(esquina + ancho/2, y, esquina + alto/2)` — el mismo
   convenio que ya usa un `THREE.BoxGeometry` normal (centrado en su propio
   origen, por eso el placeholder de caja SIEMPRE encajaba bien). Con el
   modelo real anclado por la esquina en vez de centrado, esa fórmula lo
   desplazaba MEDIO HUECO ENTERO de donde debía estar — la colisión (que sí
   usa la esquina real de la huella, `casillasDe()` en
   `server/src/construccion/construccion.ts`) se quedaba en su sitio
   correcto mientras el modelo VISIBLE aparecía desplazado, dando
   exactamente el síntoma reportado: chocar en una casilla donde a simple
   vista no hay mueble (la cama real está ahí, pero se VE media casilla más
   allá). Arreglado con un parámetro nuevo `centrarXZ` en `exportarModelo`/
   `mallarVoxeles` (`taller-vox/exportar_glb.js`) que resta medio grid en
   X/Z antes de escalar por `unit` — deja el modelo centrado en su propio
   origen en X/Z (Y se queda apoyada en el suelo, y=0, que sí es correcto)
   — verificado exportando `silla`/`cama_individual`/`mesa_comedor` y
   comprobando que el footprint real del `.glb` (`max-min`) coincide con la
   `huella` real de `interiores/catalogo/elementos.json` centrada en 0.
   **A propósito NO se toca nada de edificios/naturaleza/personajes** (los
   otros consumidores de `exportar_glb.js`) — `centrarXZ` por defecto es
   `false` (comportamiento byte a byte idéntico al de siempre) y solo el
   lote de muebles de interiores lo activa (`exportar_lote.js ... --centrar-xz`);
   si esos otros pipelines tienen el mismo bug de anclaje está sin auditar,
   fuera de esta pasada.

Tests nuevos: `taller-vox/test_muebles_proporcion.js` (7, alturas reales
contra la persona de referencia + centrado real del `.glb` exportado +
footprint coincide con la huella del catálogo). `taller-vox/test_edificio.js`/
`test_hitos_plaza.js`/`test_items.js`/`test_pj.js` sin regresión (59/59) —
confirman que el nuevo parámetro opcional no cambia nada para quien no lo pide.

**APLICADO (2026-09-06)**: el streamer pidió aplicarlo ya — `assets/interiores/`
se regeneró entera (1315 `.glb`, antes solo había 132 subidos; 9.3MB en
total) con `node generar_modelos.js && node exportar_lote.js
modelos_generados.json ../assets/interiores --centrar-xz`. Verificado de
punta a punta contra servidor+cliente reales sobre `testflat` (los 19
muebles sembrados de la Test Zone, `server/src/mundo/semillaTestZone.ts`):
red confirma `200` en la carga real de `silla_01.glb`/`cama_individual_01.glb`/
`mesa_comedor_01.glb`/etc. (no placeholder), captura real mostrando los
muebles ya proporcionados junto al jugador (antes de esta pasada una mesa
casi le llegaba a la cabeza), y el jugador se detiene pegado al borde
VISIBLE de la cama al empujar contra ella — ya no queda ningún hueco
"invisible" de colisión. Nada de esto tocó edificios/naturaleza/personajes
(fuera de alcance, siguen con el convenio de esquina de siempre).

## Bakeo de producción de naturaleza — 763 `.glb` reales, cierra el bloqueante de "Isla 1" (2026-09-08, checkpoint "¿podemos bakear Isla 1?", pedido streamer: "todo horneado ya, si algo no tiene su 3d se hace")

La auditoría de assets de esa misma pasada encontró que TODA la naturaleza del mapa exterior (vegetación + rocas, 155 especies de `baker/catalogo/{vegetacion,rocas}.json`) seguía al 0% de arte real — la herramienta (`taller-vox/generar_naturaleza.js`, 14 arquetipos) existía desde antes pero nunca se había lanzado en modo `todo` (solo la muestra de prueba, 19 especies). Es, con diferencia, el hueco de arte más grande del proyecto: la inmensa mayoría del paisaje de cualquier isla es árbol/roca/arbusto.

**Lanzado el bakeo completo**: `node generar_naturaleza.js todo` → 763 modelos (573 vegetación + 190 rocas, media de ~5 variantes por especie). Export nuevo `taller-vox/exportar_naturaleza.js` (mismo patrón que `exportar_lote.js`, pero separa por catálogo de ORIGEN porque el cliente lee vegetación y rocas de dos carpetas distintas — `exportar_lote.js` solo sabe volcar a una): 573 `.glb` a `assets/vegetacion/`, 190 `.glb` a `assets/rocas/`. Validado estructuralmente (`taller-vox/validar_glb.js` sobre una muestra amplia — vértices/triángulos/bounding box sanos, sin mesh vacío) — mismo "enganche rápido" ya usado para el lote de edificios/herramientas/armas de pasadas anteriores (decisión ya tomada por el streamer para lotes grandes de arte procedural, sin revisión pieza a pieza).

Consecuencia real: el pendiente de "Limpieza de PNG obsoletos" de abajo ya está desbloqueado para `assets/vegetacion/`+`assets/rocas/` (tienen su `.glb` equivalente completo) — sigue sin tocarse porque es una decisión de borrado, no de generación.

### Segunda pasada de proporción: armarios, baúles y objetos de pie (2026-09-11, con el mobiliario del carpintero)

La recalibración de 2026-09-06 solo tocó silla/mesa/cama. Medido en los `.glb` exportados (no a ojo): `armario_01.glb`/`estanteria_01.glb` medían 3.2 casillas — el DOBLE de una persona (1.57u) — y cualquier arcón/baúl 1.3 (a la altura del pecho); un perchero/armero/candelero de pie se quedaba en 0.7 (la rodilla) porque `generarObjetoPequeno` usaba una rejilla cúbica. `taller-vox/generar_modelos.js`: `alturaContenedorAlto(id)` (armario/estantería 1.9, cómoda/aparador/botellero 0.95, balda/expositor de pared 1.25), contenedor bajo 0.8 (caja/cajón/cesto 0.55), objetos de pie 1.5 (`H` separado de `G` en las formas de pie), piezas colgantes elevadas (`elevar`). Tests en `test_muebles_proporcion.js`. Al exportar con `exportar_lote.js` hay que pasar `--centrar-xz` (los muebles se centran, ver arriba) — sin el flag se regeneran los 1425 archivos anclados por la esquina, cosa que pasó una vez esta noche y se revirtió comparando `silla_01.glb` byte a byte contra HEAD.

Sigue igual que en el aviso de arriba: luz y props de expositor de un mueble colocado por un jugador (docs/GDD_Construccion.md §9) viven en `renderConstrucciones.ts` aparte de la malla, así que sobreviven a la sustitución placeholder → `.glb`.

## Bug real en el render de `.glb` reales de categoría "e" (edificio): ignoraba el centro sub-casilla — cierra un hueco desde 2026-09-06 (2026-09-09, encontrado construyendo la silueta de ciudad de `docs/GDD_Bakeador_POIs.md` §13)

`sectorVisual.ts`, la rama que carga el `.glb` REAL de un objeto `t:"e"` (edificios — la rama "rápida" que sustituyó los clones individuales el 2026-09-09, ver más abajo), posicionaba SIEMPRE con `globalX+0.5`/`globalY+0.5` — asumiendo que el centro real cae justo en la mitad de una casilla. La rama PLACEHOLDER (la caja de color, cuando no hay `.glb`) de la MISMA función ya leía `obj.dx`/`obj.dy` (la fracción real del centro, calculada por `ciudades/src/index.js`/`baker/src/generar.js` al partir el objeto por chunks) con un comentario explícito: "así la caja coincide con la huella real del terreno" — pero la rama del `.glb` real nunca copió ese mismo cuidado, presente desde que existe ("Construcciones de jugador... ya cargan su `.glb` real", 2026-09-03, y generalizado a edificios de ciudad después). Para cualquier huella de ancho/alto PAR (fracción de centro en .0, no en .5) el modelo real se renderizaba desplazado hasta 0.5 casillas de su huella de colisión real — silencioso hasta ahora porque la mayoría de huellas reales de `ciudades/catalogo/huellas.json` dan fracción cercana a .5 por casualidad; las piezas nuevas de esa misma noche (`puerta_asentamiento`=[6,2], `ciudad_<slug>`=[ancho,alto] siempre múltiplo de 8) tienen SIEMPRE fracción .0, exponiéndolo. Arreglado igualando esa rama a la misma lógica condicional (`grupo.tipo==="e" && obj.dx!==undefined ? obj.dx : 0.5`) que ya usaba la rama placeholder. Verificado: `cd client && npx tsc --noEmit` limpio, `client/test/streaming.test.ts`+`sectorVisualDispose.test.ts` (22/22) sin regresión — sin test unitario nuevo dedicado a esta rama específica (no existía ninguno antes tampoco), candidato real para una pasada de cobertura futura.

### Continuación real: el fix de arriba solo corrige la fracción sub-casilla — el `.glb` de un edificio está anclado por la ESQUINA, no por el centro (2026-09-09, misma noche, ver `docs/GDD_Bakeador_POIs.md` §13bis para el detalle completo)

Verificando en vivo la silueta de `docs/GDD_Bakeador_POIs.md` §13 (una pieza NUEVA, huella 184x184) se descubrió que el fix de arriba (leer `obj.dx/dy`) es necesario pero NO suficiente: corrige solo el desplazamiento SUB-casilla (`[0,1)`), pero `taller-vox/exportar_glb.js::exportarModelo` deja por defecto (`centrarXZ:false`) el `.glb` con su origen local en la ESQUINA de su propia rejilla, no en su centro geométrico — confirmado leyendo los accessors reales de `tienda_01.glb` (un edificio normal, ya bakeado, del pipeline de siempre): contenido en X∈[0.4,9.8], centro real en (5.1,4.1), NO en (0,0). Con `x=poi.x` representando el CENTRO del edificio (confirmado por la fórmula de la puerta de cualquier "edificio" POI, `poi.y + hl/2 + 1`) y el mesh anclado por la esquina sin compensación, el modelo real se renderiza desplazado del footprint de colisión por, aproximadamente, la MITAD del ancho/alto del propio edificio — no un residuo sub-casilla, un desplazamiento de varias casillas para un edificio normal (y de decenas para una pieza grande como la silueta de ciudad).

**Cerrado para las piezas de esta sesión** (`generarSiluetaCiudad`/`generar_puerta_asentamiento`, ver §13bis del GDD de POIs): exportadas con `centrarXZ:true`. **NO cerrado para el resto del catálogo de edificios** (`taller-vox/generar_edificio.js`, TODOS los edificios sueltos de POI ya bakeados en `testflat`/`ciudad_demo`/`principal`) — mismo problema estructural, confirmado empíricamente, pero de blast radius mucho mayor (cientos de `.glb` ya aprobados y subidos en varios mapas) — pendiente real, sin abordar, documentado aquí para que la próxima sesión que toque render de edificios lo tenga en cuenta antes de asumir que la posición visual de un edificio coincide con su huella de colisión. ~~Sin abordar~~ **CERRADO 2026-09-11, ver la sección "Colisión de edificios alineada con su forma real" más abajo — corrección puramente de cliente, sin tocar ningún `.glb` ya aprobado.** ~~El residuo de 0.26-1.2 unidades que dejó esa corrección quedó pendiente~~ **CERRADO DE RAÍZ 2026-09-12, ver "Colisión de edificios: cierre del residuo catálogo-vs-.glb (Fase 1)" al final de este documento — esta vez SÍ regenerando el `.glb` compartido de edificios, con `--centrar-xz`.**

## Orillas verticales tierra↔agua + faldón del borde del mapa (2026-09-10, pedido streamer: "el terreno es plano, le falta en los bordes —sobre todo donde tenemos agua— la parte vertical del terreno, ese borde que se debería generar")

El terreno de un sector eran dos planos horizontales (`sectorVisual.ts::crearTerrenoSector`): suelo a y=0 (translúcido donde hay agua) y lecho a y=-`PROFUNDIDAD_FONDO` (1.5). Entre la tierra y el agua no había NINGUNA cara vertical — en una orilla se veía el césped acabar de golpe y, a través del agua, el lecho 1.5 unidades más abajo, sin la pared de tierra que une los dos niveles. Cerrado con `client/src/render3d/orillasTerreno.ts::construirOrillas` (función PURA sobre arrays planos, sin canvas ni Three — testeable en Node): un quad vertical por cada arista tierra↔agua, del suelo al lecho, con degradado por vértice del color REAL de la casilla de tierra (78% arriba, 38% abajo — hierba que asoma por el borde y tierra húmeda abajo), todo en UNA sola `BufferGeometry` por sector (un draw call, `vertexColors`, `DoubleSide` porque una orilla mira a cualquiera de los 4 lados). `crearTerrenoSector` solo recoge en su bucle de pintado ya existente qué casillas son agua y el RGB de cada una (para agua, el color del lecho) y monta la malla. De regalo, **faldón del borde del mapa**: en los sectores que tocan el límite del mapa entero (`origenTile == 0` o `+ancho >= anchoChunks*tamanoChunk`), una pared del mismo estilo cae por debajo de los dos planos (en tierra desde y=0, bajo el agua desde el lecho — nunca atraviesa el río) — antes el plano acababa en el vacío como una hoja flotando. Sin faldón en arenas (`margenVisual>0`, bake de un solo sector donde los 4 lados serían "borde de mapa"). **Límite conocido**: las aristas tierra↔agua que caen JUSTO en la frontera entre dos sectores no se dibujan (cada sector solo conoce sus propias casillas) — 1 de cada 320 filas/columnas y solo si ahí hay orilla; resolverlo exigiría que el streaming pasara los vecinos.

**Lo que NO es**: el terreno sigue plano en altura — las bandas de elevación bakeadas (`chunk.elevacion`, 0..6) siguen cambiando solo el color, nunca la altura de la malla. Dar altura real por banda (escalones/acantilados entre casillas de tierra) es un cambio TRANSVERSAL, no de render: el servidor simula en 2D con y=0 para todo (jugadores, NPCs, fauna, construcciones, cadáveres), así que habría que desplazar en Y cada entidad según la elevación de su casilla en el cliente Y ajustar cámara/raycast de clic/colisiones visuales. Queda documentado como el siguiente paso natural si el streamer lo quiere, no abordado aquí.

Verificado: `client/test/orillasTerreno.test.ts` (7 tests: cero quads sin agua, 4 paredes alrededor de una casilla de agua aislada, alturas exactas 0/-profundidad, aristas en las coordenadas enteras correctas, degradado claro-arriba/oscuro-abajo con el color de la TIERRA (nunca el del agua), sin pared inventada contra el borde del sector, faldón en agua arrancando desde el lecho), `cd client && npx tsc --noEmit` limpio, cliente 73/73. Visor aislado nuevo `client/test/orillasAislado.{html,ts}` + `orillasAisladoCaptura.mjs` (mismo patrón que `siluetaAislada`): carga un sector REAL del mapa principal sin servidor de juego y encuadra la cámara isométrica real sobre una orilla — capturas `client/test/capturas/orillas_{rio_cerca,rio_lejos,lago_3_6}.png` confirman las paredes en el río del sector 4_6 y el lago del 3_6, con la caja roja de 1.57u de referencia de altura de persona al lado.

## Patrón de suelo horneado (2026-09-11, pedido streamer tras sugerencia de otra IA sobre texturas de bioma — "veo ambas antes de decidir" → "adelante, la prueba B es lo que hay que hacer")

El suelo era 1 color plano por casilla (`colorDebug` del catálogo, `crearTerrenoSector`). Antes de tocar nada se comparó de verdad, en el mismo entorno aislado que el resto de esta sección, 3 técnicas posibles con `client/test/texturaSueloComparacion.ts` (mismo layout sintético, mismos colores reales, misma cámara isométrica): **A** el color plano de siempre, **B** el MISMO sistema (un único canvas/textura por sector, `NearestFilter`, sin UV repetido) con más resolución por casilla y un patrón de motas/detalle horneado, **C** una textura pequeña "de verdad" repetida por GPU (`RepeatWrapping`). Capturas reales confirmaron que C tiene una costura de repetición visible (el patrón de 16x16 no es perfectamente *seamless*) mientras que B se lee limpio — el streamer, tras verlas, confirmó B.

`client/src/render3d/patronTerreno.ts` (nuevo, función PURA sobre `Uint8ClampedArray`, sin canvas ni un solo `fillRect` — testeable en Node, mismo criterio que `orillasTerreno.ts`): `generarParcheTerreno(familia, colorBase, tam, semilla)` dibuja un parche `tam`x`tam` con una base moteada común a las 6 familias (`cesped`/`tierra`/`camino`/`roca`/`arena`/`nieve`) más detalles propios (briznas+flores en césped, guijarros en tierra/camino, juntas de mampostería en roca, grano en arena, destellos en nieve) — los detalles de área (guijarros/mampostería) se DESACTIVAN por debajo de `tam=4`: a la resolución real de producción (`PX_POR_TILE_SUELO=2`) un guijarro de 2x2 cubre la casilla ENTERA siempre en la misma esquina (`rng()*max(1,tam-1)` con tam=2 da siempre 0), dando un cuadriculado binario feo en vez de guijarros sueltos — confirmado con una captura real del canvas de producción antes de este guard. `familiaPatronTerreno(id)` (`catalogoVisual.ts`) deriva la familia de campos que YA declara `terrenos.json` (`estratigrafia`, `esBaseRocosa`, `esPlaya`) en vez de una lista de ids a mano — "catálogo como fuente de verdad" (CLAUDE.md): un id de terreno nuevo cae en la familia correcta solo. Agua/hielo/lava/puente se quedan sin patrón esta pasada (su propio tratamiento translúcido/lecho es más complejo que un parche RGBA opaco).

**Caché en dos niveles, imprescindible para el rendimiento**: los parches se generan y cachean a nivel de MÓDULO por `(familia, color, tam)` — el mismo puñado de ids de terreno se repite en TODOS los sectores del mapa, así que tras el primer sector materializado en la sesión, cualquier otro solo copia bytes ya calculados. Dentro de `crearTerrenoSector`, la resolución "parche(s) para este id" se cachea POR SECTOR con una clave barata (el propio `id`, ya un string corto reutilizado) — construir la clave de caché por CASILLA (con su color de por medio) medía, en un benchmark real, más caro que el propio parche (confirmado con un benchmark en Node contra `sector_009_001.json`, el más pesado de `assets/mapas/principal/`: con clave-por-casilla, 320x320 tardaba ~75-80ms incluso en PX=1; con clave-por-id, ~15ms, igualando el coste de la versión sin patrón). `copiarParcheEnBuffer` copia un parche dentro del buffer del sector con UNA llamada a `.set()`/`.subarray()` por fila (memcpy nativo), nunca un bucle píxel a píxel.

**Bug real encontrado con el propio benchmark, antes de llegar a producción**: `hashCasilla` (semilla determinista por casilla, usada para elegir variante) hacía un `^` de JS al final, que devuelve un int32 CON SIGNO — sin forzarlo a no-negativo, `hash % NUM_VARIANTES_PATRON` podía dar un índice NEGATIVO (`array[-2]` es `undefined` en JS, no un error de rango) y reventaba `copiarParcheEnBuffer` al intentar copiar un parche inexistente. Arreglado con un `>>> 0` final.

**Resolución elegida con un benchmark real, no a ojo** (`client/test/patronSueloAisladoCaptura.mjs`, mismo patrón "Aislado" de esta sección — mide `crearTerrenoSector` AISLADA de `crearPropsSector`, cuyo coste de red de `.glb` — cientos de ms — taparía cualquier diferencia real de esta función): en este mismo sandbox SIN GPU real (ver `docs/GDD_Rendimiento.md` §7, los números absolutos no representan hardware real pero la comparación relativa en el mismo entorno sí), PX=1 (mismo camino de código, sin patrón real) cuesta ~130-139ms para el sector más pesado del mapa principal (320x320 casillas — ya incluye orillas/muro de nieve/caja de nieve, no solo el pintado de color); PX=2 (el valor elegido) ~140-151ms (+10ms); PX=4 ~163-172ms (+35ms); PX=8 ~229-243ms (+100ms). `PX_POR_TILE_SUELO=2` en `sectorVisual.ts` es la constante a subir si se pide más detalle tras ver esto en hardware real. Verificado con capturas reales del canvas de producción en bruto (`client/test/capturas/patron_suelo_raw_*.png`, extraídas directo del `CanvasTexture` del plano de suelo, sin ninguna vegetación tapando): césped con motas/briznas suaves, tierra con moteado orgánico (ya sin el cuadriculado del guard de arriba).

Verificado: `client/test/patronTerreno.test.ts` (10 tests: bytes correctos, determinismo, semillas distintas dan parches distintos, color medio cerca de la base, las 6 familias no lanzan excepción, caché por referencia, `copiarParcheEnBuffer` no toca casillas vecinas, `hashCasilla` determinista), `cd client && npx tsc --noEmit` limpio, cliente 94/94 sin regresión.

## Pared vertical de nieve en orillas internas (2026-09-11, mismo pedido streamer que el patrón de suelo: "la nieve... se ve como transparente, no tiene la capa vertical en bordes")

La caja de nieve (`crearCajaNieveSector`, ver `docs/GDD_Clima.md` §11) es UNA `BoxGeometry` por sector entero con lados sólidos — pero esos lados solo caen en el borde del SECTOR, nunca en un río/lago DENTRO del sector: ahí la cara de arriba se hace transparente sobre el agua sin ningún canto que cierre el volumen, dando la sensación de nieve fantasma/flotante. Cerrado con `orillasTerreno.ts::construirMuroNieve` — MISMA detección de arista que `construirOrillas` (es exactamente el mismo límite tierra/agua) pero la pared sube desde el suelo (y=0) hasta y=1 en vez de bajar hacia el lecho, con un blanco fijo degradado (más oscuro en la base, como un corte real de nieve apilada). Se reescala en Y junto con la caja (`aplicarNivelNieveAMuro`, mismo criterio que `aplicarNivelNieveACaja`) sin reconstruir nunca la geometría cuando cambia el nivel global de nieve. De paso, la cara de ABAJO de la caja de nieve (siempre coplanar con el suelo, invisible desde dentro del mundo) pasó de reusar el material `lado` a uno propio `visible:false` — evita overdraw/blending redundante contra el suelo real justo debajo.

Verificado con el visor aislado YA EXISTENTE `client/test/nieveAislado.ts` (`tipo=agua`, que el propio comentario del archivo documentaba desde su creación como el caso "sin pared, solo un agujero"): capturas antes/después confirman la pared sólida cerrando el volumen sobre el agua, con el cubo de referencia de altura de persona mostrando la nieve hasta la cintura tal como ya calibraba `ALTURA_MAX_NIEVE`. `client/test/muroNieve.test.ts` (6 tests: cero quads sin agua, 4 paredes alrededor de una casilla de agua aislada, alturas 0/1 nunca por debajo del suelo, color blanco fijo más oscuro abajo, sin pared inventada contra el borde del sector, mismo conteo de aristas que `construirOrillas` para el mismo mapa). `cd client && npx tsc --noEmit` limpio, cliente 94/94.

## Colisión de edificios alineada con su forma real (2026-09-11, pedido streamer: "las casas edificios etc al generarse la colision NO COINCIDE con la forma... debe ir vinculada")

Cierra el pendiente documentado desde 2026-09-09 arriba ("Continuación real:
el fix de arriba solo corrige la fracción sub-casilla — el `.glb` de un
edificio está anclado por la ESQUINA, no por el centro"). La causa exacta
ya estaba diagnosticada: `taller-vox/generar_edificio.js` exporta el `.glb`
de CUALQUIER edificio suelto de POI con `centrarXZ:false` (por defecto) —
la geometría real arranca en su local (0,0,0), que es su ESQUINA, no su
centro — mientras que `sectorVisual.ts` posiciona la instancia en el
CENTRO real del footprint (`obj.dx/dy`, ya arreglado el 2026-09-09 para la
fracción sub-casilla). Sin compensar esa esquina, el edificio entero se
renderizaba desplazado ~media anchura/altura de su propia huella de
colisión — varias casillas para un edificio normal, coherente con la queja
("la colisión no coincide con la forma": el jugador choca con aire donde
"debería" estar el edificio, y puede atravesar visualmente donde SÍ hay
colisión real).

**Cerrado sin tocar NINGÚN `.glb` ya aprobado** (la opción descartada era
re-exportar con `--centrar-xz` TODO el catálogo de edificios — cientos de
archivos en varios mapas ya subidos y aprobados por el streamer, exigiría
repasarlos todos de nuevo): la corrección vive enteramente en el CLIENTE,
en el mismo punto donde `sectorVisual.ts` ya compone la matriz de cada
instancia. `client/src/render3d/posicionEdificio.ts` (nuevo, función pura
`posicionEsquinaEdificio(centroFootprint, rotacion, anchoReal, largoReal,
escala)`, usa las clases de math de `three` — Vector3/Quaternion, sin
DOM/WebGL, corre igual en Node) resta, en espacio LOCAL ya rotado y
escalado, la mitad de la huella real (mismo `obj.w`/`obj.h` que ya usaba
la rama placeholder) — el resultado es la posición de traslación que hay
que usar para que la ESQUINA local (0,0,0) de la geometría caiga sobre la
esquina real de la huella, en vez del centro. Fundamental que sea
CONSCIENTE de la rotación: los edificios reales de una ciudad NO solo
rotan en múltiplos de 90° (confirmado en `ciudad_demo`: 45°, -135°, -180°,
-27°...), así que una compensación fija de "media anchura hacia el oeste"
solo habría sido correcta para 4 de los infinitos ángulos posibles.

**Verificado con tres métodos independientes, no dado por bueno con solo
`tsc`**: (1) `client/test/posicionEdificio.test.ts` (6 tests: sin rotación,
no muta el vector de entrada, 180° cae al lado opuesto, 90° intercambia
ancho/largo de eje con el signo exacto del convenio de rotación Y de
Three.js, la escala escala el offset, ida y vuelta exacta centro→esquina→
centro para un caso real medido). (2) Un script de verificación NUMÉRICA
leyendo los accessors reales (`POSITION.min/max`) de 4 `.glb` de edificio
YA aprobados (`alfareria_01`, `templo_01`, `tienda_02`, `casa_humilde_04`)
con sus rotaciones REALES de un sector de `ciudad_demo` — SIN el fix, el
centro real de la geometría transformada caía hasta 8.3 unidades del
centro esperado del footprint (`alfareria_01` 6.5, `templo_01` 8.3); CON
el fix, el error cae a 0.26-1.2 unidades (la parte no cerrada es el margen
real entre las dimensiones DECLARADAS en el catálogo, `obj.w`/`obj.h`, y
las dimensiones REALES del `.glb` exportado — p.ej. 9.40×7.40 contra un
catálogo de 9×6 —, un desajuste de generación distinto y más pequeño, no
abordado aquí). (3) Verificación VISUAL real: `client/test/
colisionEdificioAislado.{html,ts}` + `colisionEdificioAisladoCaptura.mjs`
(mismo patrón "Aislado" del resto de este documento) carga un sector real
de `ciudad_demo` con `crearSectorVisual` (el pipeline de producción
completo, sin atajos) y dibuja un wireframe amarillo en el footprint de
colisión ESPERADO de cada edificio (centro+`w`/`h` reales, rotados) por
encima del render real — capturado ANTES (`colision_edificio_ANTES.png`,
con `git stash` temporal del fix) y DESPUÉS
(`colision_edificio_fix.png`) del cambio: antes, cada wireframe flota
sobre tierra vacía mientras el edificio real aparece desplazado al lado;
después, los 5 edificios del sector (girados a 45°/-135°/-180°/-27°/0°)
caen limpiamente DENTRO de su propio wireframe.

Verificado además: `cd client && npx tsc --noEmit` limpio, `client/test/*.test.ts`
111/111 sin regresión (el fix solo añade una rama nueva gateada a
`grupo.tipo==="e"`, cero cambio de comportamiento para vegetación/rocas/
fauna decorativa/deco urbana). **Alcance deliberadamente acotado a
`t:"e"` (edificios)**: el mismo problema estructural (`centrarXZ:false`
por defecto) también afecta en teoría a vegetación/rocas
(`taller-vox/generar_naturaleza.js`, confirmado por el propio test de
`taller-vox` que documenta "SIN centrarXZ (comportamiento por defecto,
edificios/naturaleza/personajes) sigue ANCLADO en la esquina") — pero ahí
el desplazamiento es una fracción de una sola casilla (footprint típico
~0.5-0.8 casillas) frente a varias casillas para un edificio grande, así
que es mucho menos perceptible y NO es lo que reportó el streamer esta
vez ("casas edificios etc") — queda fuera de esta pasada, candidato para
una auditoría futura si se confirma como un problema real jugando.
~~**Pendiente real, menor**: el residuo de 0.26-1.2 unidades por el
desajuste catálogo-vs-`.glb` real (punto 2 arriba) sigue sin cerrar — se
podría reducir leyendo el `.glb` real en tiempo de bake y escribiendo sus
dimensiones exactas en vez de las nominales, cambio en el pipeline de
bake, no de cliente, fuera de alcance de esta pasada.~~ **CERRADO
2026-09-12, ver "Colisión de edificios: cierre del residuo
catálogo-vs-.glb (Fase 1)" al final de este documento.** Sin verificar en
vivo con el streamer.

## Ventanas por ala/anexo sin solape + más variedad de techos y detalle por tier/riqueza (2026-09-12, investigación previa de otro agente con números reales, esta pasada implementó y verificó los 2 planes completos)

Reescritura de `taller-vox/generar_edificio.js` en dos bloques, sin tocar
`ciudades/`/`server/`/`client/` (el `.glb` sigue siendo el mismo formato
`{grid,paleta,cajas}` de siempre, `exportar_glb.js` no cambió) ni ningún
catálogo JSON (`tipos_edificio.json`/`materiales.json`/`huellas.json`/
`asentamientos.json`) — todo el trabajo vive dentro del generador.

**Parte A — el bug real, medido con 3.060 planes reales antes de tocar
nada**: cuando un edificio tiene ala/anexo (17 de los ~74 `tipoEdificio`
tienen ala en `huellas.json::alas` — castillo/ayuntamiento/posada/
casa_gremio/mansion/cuartel_guardia/teatro/museo/academia_magia/casa_noble/
taberna/templo/granero/establo/banos_publicos/biblioteca_publica/escuela),
el camino REAL que usa `ciudades/` (`ciudades/src/generar.js` líneas
~306-313, `oy=-(h/2+ala[1]/2)` SIEMPRE — el ala siempre queda "detrás" del
cuerpo, sea L/T/U) daba **2545/3060 (83.2%)** edificios con al menos una
ventana literalmente enterrada en la masa sólida de la OTRA pieza al
fusionar. Causa doble: (1) `generarAla` pintaba ventanas en LAS DOS caras
del ala, incluida la que queda embebida (solapada) dentro del cuerpo
principal tras la fusión; (2) el cuerpo principal pintaba sus propias
ventanas sin saber que un ala se fusionaría después justo encima de esa
zona de fachada. Arreglado con 4 piezas:

- **A1, registro unificado**: un único `Map` por edificio
  (`ctx.registroHuecos`, creado una vez en `generarEdificio`), clave
  `"${piso.y0}_${cara}"` — sustituye los 3 formatos de clave distintos que
  llevaban puerta/ventana/balcón cada uno por su lado (`ventanasPorPisoCara`
  con `"${i}_${cara}"`, i=índice de planta, en 3 arquetipos). `puertaEnFachada`
  ahora devuelve `{a,c,ph}` y registra su propio hueco ANTES de que
  `ventanasEnFachada` pinte nada en esa pared — con esto el viejo heurístico
  `esFrenteConPuerta` (comparaba distancia al centro de la fachada, `vw*1.5`
  de margen) se ELIMINÓ por completo: una ventana ya no pisa la puerta
  porque la puerta está registrada como "otro hueco más" en el mismo Map.
- **A3, `MARGEN_ENTRE_HUECOS=2`** (antes ±1 vóxel a fuego dentro de
  `rangoLibre`) — exportado, para que un test pueda referenciarlo sin
  repetir el número.
- **A4, zona prohibida por ala**: `alas[]` (antes calculado DESPUÉS de
  llamar al arquetipo, solo para la fusión) se adelanta a ANTES —
  `offsetAla`/`offsetPiezaPlan` no dependen de nada que calcule el
  arquetipo, así que mover el cálculo es seguro. Cada ala se expande por
  `MARGEN_SEGURIDAD_ALA=4` en una caja absoluta (`zonasAlas`), pasada al
  arquetipo; dentro de `ventanasEnFachada`, antes de colocar una ventana en
  una pared, cualquier zona cuyo rango en el eje PERPENDICULAR a esa pared
  llegue a tocarla se proyecta sobre el eje de la pared y se registra como
  "otro hueco ya puesto" (reusa `rangoLibre`, cero comprobación nueva).
  `generarAla` gana un parámetro `caraEmbebida` (mapa `{E:"O",O:"E",N:"S"}`
  por lado del ala, confirmado geométricamente con `offsetAla`/
  `offsetPiezaPlan` — el ala real de producción, siempre "N", mete su cara
  "S" en el cuerpo) y deja de pintar ventanas en esa cara, solo en la
  opuesta.
- **A5, catálogo de tejados**: `techoEnEscalones` extraído del bucle que
  antes solo usaba `techoDosAguas` (ahora un caso particular de una sola
  llamada) + 2 primitivas nuevas — `techoMansarda` (dos tramos del mismo
  helper, pendiente≈1.3 hasta encoger 35%, luego pendiente≈0.15 casi plano)
  y `techoCobertizo` (única rampa desde un borde, sin cumbrera, función
  propia — geometría genuinamente distinta a la simétrica de
  `techoEnEscalones`). `ESTILOS_TECHO`+`elegirEstiloTecho` (mismo patrón
  catálogo+pesos que `ESTILOS_VENTANA`), tirado UNA vez por edificio junto
  al resto de decisiones de aspecto (antes de `densidadVentanas`/`forma`).
  Gates: CHOZA/GRANERO/TALLER → dosAguas/cobertizo; CASA/POSADA →
  dosAguas/mansarda/cobertizo (+piramidal si noble y ≥1 planta alta);
  INSTITUCION → piramidal/abovedado/mansarda; TEMPLO/MILITAR/TORRE/CASTILLO
  **sin catálogo, silueta intacta** (ni siquiera consumen el rnd() nuevo).

**Parte B — 16 variaciones nuevas por tier/riqueza**, reusando el registro
de la Parte A donde hace falta (antorchas):

- **Bloque A, chimeneas**: `chimenea()` gana `estilo` ('fina'/'maciza' —
  radio 0.22×U + colarín + capucha), 70% maciza en noble+piedra; extendida
  (fina, sin brasas) a INSTITUCION (~25%, tejado trasero) y TEMPLO (~20%,
  sacristía), arquetipos que antes nunca tenían.
- **Bloque B, pórtico**: `porticoColumnas` (ya usada por INSTITUCION)
  reutilizada en CASA/TALLER, 35% si noble+piedra, MUTUAMENTE EXCLUSIVO con
  el porche pequeño de madera de CASA (si sale pórtico no se tira el dado
  del porche). Sub-variante "doble altura" (`alturaColumnasPortico`, ≥2
  plantas altas, 20%).
- **Bloque C, escudo**: `blasonFachada` gana un parámetro `paleta` (subset
  discreto `PALETA_BLASON_FAMILIAR`, 2 colores) — reusada en CASA, 45% si
  noble+piedra (menos que el 80% institucional).
- **Bloque D, antorchas** (`antorchasJuntoPuertaDet`, nueva): mango +
  llama a los lados de la puerta, comprueba el registro de huecos antes de
  pintar. Humilde 15% individual, modesta 35%/noble 55% pareja; CASTILLO/
  MILITAR pareja al 100% SIN roll — y registradas ANTES que las ventanas de
  su propia fachada Sur (al revés que el resto de arquetipos): con un
  portón tan ancho como el de un castillo, dejar que las ventanas se
  repartieran primero podía dejar sin hueco libre a las dos antorchas en la
  MISMA semilla — bug real encontrado por el propio test de este bloque,
  cerrado invirtiendo el orden de registro en `edificioCastillo`/
  `edificioMilitar`.
- **Bloque E, entramado + barro**: `cuerpo()` gana `entramadoPlantaBaja`
  (antes el entramado Tudor era SIEMPRE `p>0` a fuego) — en CHOZA y en la
  rama humilde de CASA, 30% si material=madera, sustituye `colorMuro` por
  `BARRO` (= `materiales.adobe.colorDebug`, reusado del catálogo, nunca
  inventado) antes de `cuerpo()`.
- **Bloque F, decoración de pared**: `lenaApilada`/`barrilOCestaJuntoPuerta`/
  `hiedraTrepando` (nuevas), ~35% conjunto, 1 de las 3 por semilla, pesos
  por riqueza/material — en CASA/CHOZA/TALLER/POSADA.

**2 bugs de test reales encontrados y cerrados verificando, ninguno visible
solo con `tsc`**: (1) `TRONCO_CLARO` (Bloque F) se eligió como `"#8a6a3a"`
sin comprobar contra el catálogo — resultó ser EXACTAMENTE
`materiales.madera.colorDebug`, así que cualquier comprobación por color
de "hay leña apilada" daba 100% en vez de ~35% (coincidía con CUALQUIER
muro de madera, la pared más común del proyecto) — cerrado eligiendo
`"#9c7a4a"`/`"#5c4020"`, verificados programáticamente contra
`sombrear(materialX, f)` de TODOS los materiales del catálogo en el rango
f∈[0.5,1.3] antes de fijarlos. (2) el primer intento de `antorchasJuntoPuertaDet`
calculaba la separación como `Math.round(pw/2)+2` — con una puerta ancha
(castillo, `pw=16`) esto caía DENTRO del margen de `MARGEN_ENTRE_HUECOS` de
la propia puerta y `rangoLibre` la rechazaba las dos veces siempre —
cerrado derivando la posición directamente de `puerta.a`/`puerta.c` con una
holgura `MARGEN_ENTRE_HUECOS*2+2`, garantizada matemáticamente suficiente.

**Verificado** (`taller-vox/test_edificio.js`, 42/42, +16 tests nuevos
sobre los 26 ya existentes, todos sin tocar sus aserciones): (a) ninguna
ventana solapa la puerta real en 3D (marco incluido), 74 tipos × 30
semillas, 2220 comprobaciones; (b) ninguna ventana de una pieza queda
enterrada en la masa de la OTRA pieza fusionada, 17 tipos con ala × 3
formas forzadas (T/L-derecha/L-izquierda, replicando
`ciudades/src/generar.js`) × 20 semillas = 1020 combinaciones, **0
enterradas** (el campo nuevo `modelo.limitesPiezas` — fronteras reales
entre cuerpo principal y cada ala en índices de `cajas` — deja el test
centrado en el solape ENTRE piezas, sin confundirlo con un solape interno
de la MISMA pieza como el frontón de un pórtico institucional cruzando una
ventana de su propio piso de arriba, un problema real pero DISTINTO y
fuera de alcance de esta pasada); (c) `MARGEN_ENTRE_HUECOS` verificado
matemáticamente vía `rangoLibre` directo; (d) variedad real de techo
(≥2-3 formas distintas en 40 semillas según el arquetipo) y
TEMPLO/MILITAR/TORRE/CASTILLO confirmados con `estiloTecho===null`; (e) los
6 bloques de la Parte B confirmados presentes en AL MENOS una de 40-100
semillas de `casa_noble`/`casa_modesta`/`casa_humilde` y AUSENTES en la
riqueza que no les corresponde. `taller-vox/verificar_alas_muestra_completa.js`
(nuevo, NO en `node --test`, para reconfirmar cuando se quiera): la muestra
COMPLETA de 3.060 planes (17×60×3, el mismo tamaño que la investigación
original) da **0/3060 (0.0%)**, 0.4s. Sondeo de frecuencias reales sobre
100 semillas de cada riqueza de CASA confirmó que las probabilidades
pedidas se cumplen dentro del ruido esperado de una muestra de 100
(chimenea maciza 28/46 piedra-noble ≈61% del 70% pedido, pórtico 20/46≈43%
del 35%, escudo 23/46≈50% del 45%, antorchas 48/100 noble/30/100
modesta/10/100 humilde, entramado-barro 21/47 madera-humilde, decoración
de pared 21-33/100). `taller-vox/test_hitos_plaza.js`+`test_muebles_proporcion.js`+
`test_pj.js` (28/28) sin regresión — `test_items.js` tiene 2 fallos
preexistentes y completamente ajenos (no importa `generar_edificio.js`,
confirmado por grep), sin relación con esta pasada.

**Verificación VISUAL real** (Vite dev + Playwright + `client/test/
verGlbAislado.html` con `&encuadre=auto`, sirviendo `.glb` de una carpeta
de staging DENTRO de `taller-vox/vox_edificios/` — ya gitignorada,
"salidas del taller (regenerables)" — vía la ruta `/@fs/` de Vite,
`fs.allow` ya cubre la raíz del repo; NINGÚN `.glb` de prueba tocó
`assets/edificios/`, carpeta de staging borrada al terminar): (i)
`posada` en T y `casa_noble` en L — ala fusionada sin ninguna ventana
flotando/enterrada en el punto de unión, confirmado a ojo en las dos
capturas; (ii) `taberna`/`granero` con `techoCobertizo` — rampa única
claramente asimétrica, sin cumbrera; (iii) `casa_noble`/`ayuntamiento` con
`techoMansarda` — perfil de dos pendientes visible (más pronunciada cerca
del alero, casi plana hacia la cumbrera); (iv) `casa_noble` con
pórtico+escudo+antorchas a la vez (semilla forzada por script, vista desde
el lado Sur real con un parámetro `&lado=sur` añadido TEMPORALMENTE a
`verGlbAislado.ts` para este único chequeo y revertido con `git checkout`
antes de comitear, cero cambio en el commit final) — escudo y las dos
antorchas claramente visibles y sin solaparse con la puerta; las 6
columnas del pórtico + el arquitrabe SÍ están (confirmado leyendo las
cajas reales: 6 cajas de columna + 1 de arquitrabe, geometría correcta) —
**hallazgo visual honesto**: contra un muro de piedra del mismo tono
(`sombrear(colorMuro,1.15)` re-sombreado a 0.8 para la columna) las
columnas se leen muy sutiles a este zoom/iluminación, casi fundidas con la
pared — geométricamente correcto, pulido de contraste de color posible
más adelante si el streamer lo pide al verlo en persona, no abordado aquí
(scope creep fuera de lo pedido). (v) `casa_humilde`/`choza_pescador` con
entramado+barro — tono adobe claramente distinto del wood-plank o Tudor
de estuco de siempre, con las riostras diagonales visibles.

## Colisión de edificios: cierre del residuo catálogo-vs-.glb (Fase 1) (2026-09-12, continuación de "Colisión de edificios alineada con su forma real" — retoma un agente interrumpido por límite de sesión a mitad de tarea, con el trabajo ya bien encaminado en su worktree)

La sección anterior ("Colisión de edificios alineada con su forma real",
2026-09-11) cerró el bug GRANDE (esquina-vs-centro, varias casillas de
desplazamiento) con matemática pura en el cliente
(`posicionEsquinaEdificio`), sin tocar ningún `.glb` — pero dejó un residuo
DISTINTO y más pequeño, documentado explícitamente como pendiente: el
lote compartido `assets/edificios/<tipo>_01..04.glb` (una única malla por
`tipoEdificioId`, reusada por TODAS las instancias de ese tipo en
cualquier ciudad) se genera con `taller-vox/generar_edificio.js
generarTodo()` — que, SIN ningún plan de instancia real (`plan=null`),
elegía su propia forma con `elegirForma(rnd, ...)`: una elongación
aleatoria del ancho/alto Y una probabilidad de meter un ala/anexo, un
sorteo PROPIO y ajeno al que `ciudades/src/generar.js` hace por su cuenta
para cada instancia real (`w = base[0] + jitter(±1)`, más su propia
tirada independiente de ala en `huellas.alas`). Como la malla compartida
nunca refleja la forma real de ninguna instancia concreta, comparar sus
accessors contra el footprint declarado en el catálogo daba SIEMPRE un
residuo — no un simple redondeo, dos PRNG distintos comparados entre sí.

**Arreglado con `opciones.formaFija`** (`generar_edificio.js`): cuando
`generarTodo()` genera el LOTE COMPARTIDO (la única invocación real de
`generarTodo` sin un `plan` de instancia detrás), `elegirForma()` devuelve
siempre `{ancho:anchoBase, largo:largoBase, ala:null}` — el footprint
BASE de `ciudades/catalogo/huellas.json::porTipo`, sin elongación propia
ni ala propia — en vez de tirar sus propios dados. El resto de
`generarTodo()` (galerías de prueba, tests) no pasa este flag, así que su
comportamiento no cambia. Con esto, el lote compartido deja de ser una
forma arbitraria y pasa a ser la representación más fiel posible de "un
edificio de este tipo, sin modificar" — el mismo criterio que ya usa
cualquier huella declarada del catálogo.

**Regenerado el lote entero con `--centrar-xz`** (mismo flag ya probado
con el mobiliario de interiores, 2026-09-06): los 296 `tipoEdificioId`×4
variantes (312 `.glb` finales en `assets/edificios/`, tras contar también
los que ya tenían más de 4 variantes de pasadas anteriores) se
reexportaron con el mesh centrado en su propio origen local — antes
anclado por la esquina (`centrarXZ:false`, el default histórico de
edificios/naturaleza). Con esto, `client/src/render3d/sectorVisual.ts` YA
NO necesita ninguna compensación esquina-vs-centro para `t:"e"`: se quitó
la llamada a `posicionEsquinaEdificio` (y el import, ahora muerto en este
archivo — la función se queda exportada en `posicionEdificio.ts`, con su
test intacto, por si algún `.glb` futuro vuelve a anclarse por esquina) y
la rama de edificios pasó a usar EXACTAMENTE el mismo camino que ya usaba
la rama placeholder (`obj.dx`/`obj.dy`, el centro real sub-casilla).

**Segundo bug real cerrado de paso, más grave que el residuo de forma**:
`ciudades/src/index.js::exportarCiudad` iteraba `for (const p of
ed.piezas)` y exportaba un objeto renderable `t:"e"` POR PIEZA (cuerpo +
cada ala), los tres con el MISMO `i`/`va` (la misma referencia al `.glb`
compartido) — antes de esta pasada eso tenía sentido porque el
placeholder de caja necesitaba una caja por pieza para que el ala también
tuviera terreno sólido visible debajo; pero con un `.glb` REAL compartido,
`sectorVisual.ts::crearPropsSector` agrupa instancias por
`${t}:${i}:${variante}` y monta UN `InstancedMesh` por grupo — así que un
edificio con ala (L/T/U, 17 `tipoId` reales de `huellas.json::alas`)
producía DOS instancias del MISMO edificio en DOS posiciones distintas: un
edificio fantasma duplicado, desplazado la mitad del ala del original.
Cerrado exportando el objeto renderable SOLO para `ed.piezas[0]` (el
cuerpo principal) — las alas siguen alimentando la colisión/terreno sólido
del bake (`generar.js::rasterizarPiezas`, sin tocar), simplemente ya no
generan un segundo objeto visible. **Limitación aceptada a propósito**: un
edificio con ala real tiene hoy terreno sólido correcto sobre el ala pero
NADA visible ahí (mejor que un fantasma duplicado, no un edificio con ala
visible de verdad — eso exigiría un `.glb` único por instancia, "Fase 2",
cambio de arquitectura mayor, fuera de alcance de esta pasada, pendiente
de que el streamer lo pida con su propio alcance).

**Verificado con 5 métodos independientes, no dado por bueno con solo
compilar**: (1) 312/312 `.glb` regenerados válidos estructuralmente
(`taller-vox/validar_glb.js`, 0 inválidos). (2) Lectura NUMÉRICA de
accessors reales tras el fix: `taberna_01.glb` (catálogo base [10,8]) sale
centrado en (0,0) con rango X∈[-5.3,5.3]/Z∈[-4.3,4.3] (10.6×8.6, el
pequeño sobrante es decoración real — ventanas/porche — que sobresale del
rectángulo base); `templo_01`/`posada_01`/`casa_gremio_01` (catálogo
[12,9]) dan 12.4-12.6×9.4-9.6, mismo patrón — antes de este fix ninguno de
estos cuatro habría estado centrado ni habría coincidido con su base de
catálogo, por construcción (formas y alas propias sorteadas sin relación
con `huellas.json`). (3) Duplicados: generados 8 `pueblo` reales
(151 edificios totales, 18 con ala/anexo real) con `generarCiudad`+
`exportarCiudad` de PRODUCCIÓN, sin atajos — **151 edificios ⇒ 151
objetos `t:"e"` exportados, exactamente 1:1** (con el código viejo
habrían sido 169: uno por cada una de las 36 piezas de los 18 edificios
con ala, más los 133 sin ala). (4) Verificación VISUAL real con el
harness YA EXISTENTE `client/test/colisionEdificioAislado.{html,ts}`
(pipeline de producción completo, `crearSectorVisual` sobre un sector real
de `ciudad_demo`) — captura confirma los edificios visibles cayendo dentro
de su wireframe de colisión esperado, sin desplazamiento perceptible. (5)
Bake real de `baker/config/ejemplo-rapido.json` completo sin errores
nuevos (mismo único aviso preexistente de caminos, sin relación con
edificios). `cd client && npx tsc --noEmit` limpio, `cd server && npx tsc
--noEmit` limpio, cliente 111/111, servidor 1356/1356 (cero archivo de
servidor tocado, sin regresión), `ciudades/test/ciudad.test.js` 15/15,
`taller-vox/test_edificio.js` 42/42 — todos sin regresión.

**Pendiente real, explícitamente fuera de alcance**: "Fase 2" (un `.glb`
único generado por instancia real, con su forma/ala/elongación exactas)
NO se implementó — exigiría generar y exportar un modelo por CADA edificio
de CADA ciudad bakeada (miles, no cientos) en vez de un lote compartido de
4 variantes por tipo, cambio de arquitectura que necesita OK explícito del
streamer antes de tocarlo. Un edificio con ala sigue sin arte visible
sobre esa ala (solo terreno sólido). Sin verificar en vivo con el
streamer — mismo criterio honesto del resto de esta sesión.

## Qué falta (pendiente, no bloquea lo anterior)

- **Bakeo de producción de ítems** (armas/herramientas/objetos/comida): la herramienta de arriba está lista; falta que el streamer decida lanzar `generar_*.js` sin `--muestra` sobre los 195 ids reales, revisar en el visor, y aprobar/subir a `assets/armas|herramientas|objetos|comida/`. Los 33 `cadaver_*` de objetos seguirán con placeholder hasta que se diseñe un arquetipo propio para restos de animal. **Aclaración real (2026-09-07, docs/GDD_Inventario.md §12bis)**: esto NO es lo mismo que "verse en la mano equipado" — lo que un jugador tiene EQUIPADO (`slotEquipo`, `manoPrincipal` incluido) se genera EN VIVO en el navegador vía `ropa/catalogo/equipo.json`/`generarEquipoVoxel.ts` (caja simple coloreada por material, ver sección de abajo), completamente aparte de este bakeo — `equipoVisual.ts::aplicarEquipoAlRig` no intenta cargar ningún `.glb` de aquí todavía. Las 66 herramientas del catálogo (`herramienta_*`) YA se ven en la mano desde esa pasada (con la caja simple); ESTE bakeo, cuando se lance, mejoraría su fidelidad (11 arquetipos por silueta real en vez de una caja) pero requiere ADEMÁS enganchar `equipoVisual.ts` a probar el `.glb` real primero (mismo patrón que `renderConstrucciones.ts` ya usa para muebles) — cambio de render de cliente, no solo de bakeo, todavía sin hacer.

- ~~**Consumo de interiores**~~ **HECHO**, ver `docs/GDD_Sistema_Puertas.md`: el cliente hace `fetch` directo del interior bakeado (`/assets/mapas/<mapaId>/interiores/<edificio>.json`) al cruzar la puerta, `client/src/render3d/interiorVisual.ts` lo instancia entero (paredes, mobiliario, ventanas, luces), y una `InteriorRoom` de Colyseus lleva la colisión/portales — la geometría viaja por fetch de asset estático, no por Schema. Con oclusión dinámica (cono de visión) y luz ambiente por hora del día ya resueltos también (mismo documento).
- ~~Carga perezosa de sectores + luz que sigue a la cámara~~ — **HECHO** (mecánica principal pactada con el streamer, ver sección siguiente).
- **Catálogo de personajes/armas**: sigue sin existir `catalogo/personajes.json` (a propósito) — cuando toque el creador de personajes, se crea con el mismo patrón (`variantes`/`colorDebug`) y el rig ya definido en `rigHumanoide.ts` como esqueleto base.
- **Fauna viva**: los objetos `t: "a"` del bake se pintan como marcadores estáticos de spawn; darles movimiento/IA es mecánica de servidor (fase futura), no del render.
- **Limpieza de PNG obsoletos**: decidir cuándo borrar los placeholders 2D de `assets/{vegetacion,animales,rocas}/` una vez tengan su `.glb` equivalente.
