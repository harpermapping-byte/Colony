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

**Prueba visual**: `taller-vox/prueba_render_items.js` dibuja una galería SVG isométrica (mismo mini-render que `personajes/src/renderIso.js`) de la muestra de las 4 categorías → `output/galeria_items_muestra.svg` (+ `.png` vía Playwright, mismo patrón que `prueba_render_naturaleza.js`).

**Tests**: `taller-vox/test_items.js` (`node --test test_items.js`, 16 tests) — clasificación sin arquetipo faltante para el catálogo real completo (19+70+75+31 ids), geometría válida (cajas no vacías, paleta no vacía, grid positivo) para TODOS los ids reales de las 4 categorías (barato: solo cálculo en memoria, no exporta nada), determinismo por id, longitud creciente con `huella`, cobertura de objetos documentada (SIN_COBERTURA/BARCO), y exportación `.glb` real de una muestra de 4 ids (uno por categoría) verificando la cabecera binaria `glTF`.

## Qué falta (pendiente, no bloquea lo anterior)

- **Bakeo de producción de ítems** (armas/herramientas/objetos/comida): la herramienta de arriba está lista; falta que el streamer decida lanzar `generar_*.js` sin `--muestra` sobre los 195 ids reales, revisar en el visor, y aprobar/subir a `assets/armas|herramientas|objetos|comida/`. Los 33 `cadaver_*` de objetos seguirán con placeholder hasta que se diseñe un arquetipo propio para restos de animal.

- ~~**Consumo de interiores**~~ **HECHO**, ver `docs/GDD_Sistema_Puertas.md`: el cliente hace `fetch` directo del interior bakeado (`/assets/mapas/<mapaId>/interiores/<edificio>.json`) al cruzar la puerta, `client/src/render3d/interiorVisual.ts` lo instancia entero (paredes, mobiliario, ventanas, luces), y una `InteriorRoom` de Colyseus lleva la colisión/portales — la geometría viaja por fetch de asset estático, no por Schema. Con oclusión dinámica (cono de visión) y luz ambiente por hora del día ya resueltos también (mismo documento).
- ~~Carga perezosa de sectores + luz que sigue a la cámara~~ — **HECHO** (mecánica principal pactada con el streamer, ver sección siguiente).
- **Catálogo de personajes/armas**: sigue sin existir `catalogo/personajes.json` (a propósito) — cuando toque el creador de personajes, se crea con el mismo patrón (`variantes`/`colorDebug`) y el rig ya definido en `rigHumanoide.ts` como esqueleto base.
- **Fauna viva**: los objetos `t: "a"` del bake se pintan como marcadores estáticos de spawn; darles movimiento/IA es mecánica de servidor (fase futura), no del render.
- **Limpieza de PNG obsoletos**: decidir cuándo borrar los placeholders 2D de `assets/{vegetacion,animales,rocas}/` una vez tengan su `.glb` equivalente.
