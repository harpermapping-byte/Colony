# Sistema de puertas — instancias exterior↔exterior e interior (v1)

Cómo un jugador cruza de una instancia a otra: del Hub a una aldea/POI, de esa aldea al interior de un edificio, y vuelta. Léelo antes de tocar `server/src/rooms/`, `server/src/mundo/mapaColision.ts`/`interiorColision.ts`, o `client/src/game.ts`.

## Decisión (confirmada con el streamer, 2026-08-28)

- **Activación: tecla de interacción (F)**, no automático al pisar — evita cruces accidentales al pasar cerca de una puerta.
- **Cambio de sala = recarga de página con otros parámetros de URL.** Más simple y robusto que reconstruir la escena de Three.js/el streaming de sectores en caliente; el coste es un parpadeo de carga en cada cruce. Una transición sin recarga (loading screen propio) es una mejora futura, no v1.
- **Una instancia por `mapaId` (regiones) o por `mapaId`+`edificio` (interiores)**: Colyseus `filterBy` hace que dos jugadores que entran al MISMO sitio caigan en la MISMA room; otro sitio es otra room — el "tope de jugadores" de las instancias es simplemente `maxClients` de esa room (40, heredado del Hub).

## Arquitectura

### Datos: `portales` en el `indice.json` bakeado

`ciudades/src/generar.js` ya escribía un array `portales` (sin consumir hasta ahora): `{tipo:"exterior"|"interior", x, y, edificio?, tipoEdificioId?}`. Se amplió el TIPO (no el bakeador) con un campo opcional `destino: {tipo:"region"|"hub", mapaId?}` para portales "exterior" de un mapa PADRE (hoy solo se usa a mano en mapas de prueba — ver "Qué falta"): sin `destino`, un portal "exterior" es la salida propia de ESE mapa hacia quien entró ahí.

### Servidor: tres tipos de room, una base compartida

- `server/src/rooms/base/RoomExteriorBase.ts` — extrae el movimiento/colisión/nadar-bucear/empuje-PJ que antes vivía solo en `HubRoom` (idéntico comportamiento, cero cambio de física) a una clase base reusable por cualquier room que juegue sobre una rejilla (`MundoColision`, ya genérica). Cada subclase carga SU rejilla y llama a `iniciarMovimiento()`.
- `HubRoom` (`"hub"`, singleton) — extiende la base, añade construcción/parcelas/jarl (sin cambios) y el manejador `"portal:usar"` para sus propios portales.
- `RegionRoom` (`"region"`, `filterBy(["mapaId"])`) — una aldea/POI bakeado por `ciudades/`: MISMO formato de mapa/colisión que el Hub, SIN construcción/parcelas/jarl (v1: las regiones de `ciudades/` no son terreno de jugadores todavía). `onCreate(options.mapaId)` resuelve la carpeta vía `mundo/resolverMapa.ts` (`assets/mapas/<mapaId>/`).
- `InteriorRoom` (`"interior"`, `filterBy(["mapaId","edificio"])`) — el interior YA bakeado de un edificio (`<mapaId>/interiores/<edificio>.json`, el mismo JSON que `interiores/src/edificio.js` genera). `mundo/interiorColision.ts` lo convierte a una rejilla `MundoColision`: cada sala de la PLANTA BAJA se marca pisable, y sus muebles con `colision:true` (mismo catálogo que ya usa `construccion/catalogo.ts` para las construcciones de jugador) endurecen sus casillas.
- Radio de interacción de un portal: 2.2 casillas (probado con Playwright que 1.5 se quedaba corto en la práctica — un jugador real casi nunca para exactamente sobre la casilla).

### Cliente: la URL decide la sala

`client/src/game.ts` lee `?sala=region|interior&mapaId=...&edificio=...&entradaX/Y=...&origenSala=...&puertaX/Y=...` (sin `sala` = Hub, comportamiento de siempre). Según `sala`:
- **hub/region**: streaming de sectores de siempre (mismo formato, solo cambia la ruta) — `region` sencillamente NO monta el constructor ni la demo de personajes.
- **interior**: se salta el streaming entero; hace `fetch` directo del JSON del interior (servible como estático, vive bajo `assets/mapas/<mapaId>/interiores/`) y lo pinta con `client/src/render3d/interiorVisual.ts` — placeholder de cajas de color por sala/mueble (mismo criterio "todo el arte es placeholder" del resto del proyecto), sin streaming ni paredes/techo todavía.
- Tecla **F** → `room.send("portal:usar")` (el servidor decide si hay puerta cerca, el cliente no calcula proximidad). La respuesta `"portal:ir"` construye la siguiente URL y hace `location.search = ...` (recarga). "Volver" desde un interior va a la región de la que colgaba (a la puerta exacta, con `entradaX/Y`) si `origenSala` era `"region"`, o al Hub si se entró directo desde ahí; "volver" desde una región siempre va al Hub (v1: sin pila de más de un nivel).

## Verificado

- Prueba manual con Playwright (`client/test/prueba_visual_puertas.cjs`, no forma parte de la suite): hub de prueba → puerta → aldea REAL bakeada (`ciudades/`) → puerta de una `casa_modesta` → **interior real con sus salas y muebles** → puerta → vuelta a la aldea justo en la puerta de la casa. Capturas en `client/test/capturas_puertas/` (gitignored, regenerable).
- Regresión de lo existente, ambos en verde tras el refactor de `HubRoom`: `client/test/streaming.e2e.cjs` (5/5, mapa principal real) y `client/test/construccion.e2e.cjs` (15/15 — construir, reiniciar servidor con la misma BD, interior de construcción de jugador intacto).
- `server` 32/32 tests, `tsc --noEmit` limpio en server y cliente.

## Ampliación (2026-08-28) — coherencia bakeador↔render y salas de verdad conectadas

Feedback del streamer tras ver las primeras capturas: la caja 3D del edificio no coincidía con su huella pintada en el suelo, dentro de los edificios no se podía pasar de una sala a otra, no había paredes, y las paredes se veían vacías de decoración. Encontrado y arreglado, de raíz en cada caso (no parches):

### 1. La caja 3D del edificio no coincidía con el suelo
`ciudades/src/index.js` exportaba la posición de cada edificio REDONDEADA a la casilla entera (`Math.floor`), pero el terreno bakeado marca "solar_edificio" con el centro EXACTO (con decimales, tras rotar la huella) — desviación de hasta ~0.7 casillas. Arreglado con dos campos nuevos `dx`/`dy` (parte fraccionaria del centro) SOLO en los objetos `t:"e"` (edificios) — vegetación/decoración no los necesitan, un árbol medio metro desplazado no se nota. `client/src/render3d/sectorVisual.ts` los usa para centrar la caja en el punto real en vez del centro genérico de la casilla.

### 2. No se podía cruzar de una sala a otra (bug real, no solo falta de código)
Encontramos y arreglamos CUATRO bugs encadenados, cada uno confirmado con un flood-fill de verdad sobre bakes reales antes de darlo por bueno:

1. **La puerta de conexión entre salas nunca se guardaba.** `interiores/src/edificio.js` calculaba las puertas reales (la propia de cada sala hacia el pasillo, y la punzada a mano entre dos salas en fila sin pasillo) pero esa información se perdía en memoria — el JSON exportado no la traía. Ahora cada planta serializa `puertasConexion: [{x,y}, ...]`.
2. **La colisión de interiores reusaba la regla del sistema de CONSTRUCCIÓN** ("todo bloquea salvo FLOOR_DECAL" — pensada para lo poco que coloca un jugador), pero un interior bakeado por `interiores/` viene lleno de clutter decorativo ("suciedad": hojas secas, escombros, nidos de rata; "iluminacion": antorchas) que nunca debería bloquear — una sala de 20 casillas con 9 piezas de este tipo salía casi intransitable. `interiorColision.ts` ahora tiene su PROPIA regla: esas dos capas nunca bloquean.
3. **El mobiliario se coloca sin saber dónde caerá la puerta de conexión** (eso se decide después, entre salas, no dentro de `colocarSala`) — a veces un mueble terminaba justo encima. Se despeja la puerta y su umbral tras colocar todo.
4. **`plantas[0]` NO es siempre la planta baja**: un edificio con bodega (`tieneBodega:true` — casa_noble, taberna, posada, casa_gremio, ayuntamiento...) trae el SÓTANO en el índice 0. `cargarInterior` cargaba el sótano por error, con su propio tamaño de rejilla, dejando el resto del edificio fuera de la colisión entera. Ahora busca por `rol === "planta_baja"` explícito, nunca por posición — mismo arreglo en el cliente (`interiorVisual.ts`).

Además, una **garantía final de conectividad**: tras montar todo, se comprueba con flood-fill real desde el spawn qué sala queda fuera y, si alguna lo está (clutter conspirando para sellar un hueco, caso raro pero posible), se abre un pasillo recto de una casilla hasta ella — más vale un mueble desaparecido en un caso raro que un jugador atascado en su cuarto.

### 3. Paredes: ahora se ven
`interiorVisual.ts` dibuja las 4 paredes de cada sala casilla a casilla, con hueco exacto en cada `puertaConexion` real. **Sin oclusión dinámica todavía** (estilo Project Zomboid: la pared que da a cámara desaparece, la de fondo se ve) — se ven TODAS las paredes siempre, así que desde fuera/arriba el edificio se ve como una casa de muñecas. Pendiente, ver abajo.

### 4. Paredes vacías de decoración
`interiores/catalogo/elementos.json` tenía solo ~11 piezas puramente decorativas de pared frente a 40+ de suelo. +12 nuevas (estante_especias, sarten_colgada, ristra_ajos, reloj_pared, mapa_pared, guirnalda_flores, banderin_gremio, panoplia_armas, campana_servicio, herradura_suerte, estandarte_capilla), repartidas por tipos de sala antes desatendidos (cocina, taller, tienda, capilla, cuadra).

### 5. Vegetación/decoración urbana en aldeas — verificado, YA funcionaba
Comprobado contra un bake real: los árboles/arbustos de las zonas verdes SÍ se exportan y aparecen en el mapa (25 objetos de vegetación en la aldea de prueba). La decoración urbana (`ciudades/catalogo/decoracion.json`) ya tiene 26 piezas variadas (puestos de mercado, pozo, fuente, farolas, bancos...). No hizo falta tocar nada aquí.

### Verificado
- Nuevo test de regresión permanente (`server/test/interiorColision.test.ts`, 2 tests): TODAS las salas de la planta baja alcanzables desde el spawn, en 6 tipos de edificio × 3 semillas (con y sin bodega, con y sin pasillo); el spawn nunca cae en una casilla sólida. Cazó los 4 bugs de arriba antes de darlos por arreglados.
- Prueba manual con Playwright repetida de punta a punta tras los arreglos: capturas nuevas muestran las salas conectadas con huecos reales en las puertas y paredes visibles (antes: plano de suelo desnudo sin muros).
- Regresión completa en verde: server 34/34, interiores 32/32 (JSON del catálogo validado, sin referencias rotas), poblacion 26/26, ciudades 8/8, `construccion.e2e.cjs` 15/15 (el sistema de construcción de jugador usa el MISMO `edificio.js` — confirmado que sigue intacto), tsc limpio en server y cliente.

## Ampliación (2026-08-28) — escaleras = TP entre plantas

Antes: `conectoresVerticales` era metadato puro ("esta planta y la de arriba se tocan en algún sitio de la sala X") sin coordenada de casilla concreta, sin pieza visual, y `interiorColision.ts`/`InteriorRoom` solo sabían cargar/servir la planta baja. Ahora:

- **`interiores/src/edificio.js`**: cada entrada de `conectoresVerticales` lleva `posicionAbajo`/`posicionArriba` (casilla real, en coordenadas de la rejilla de CADA planta — las plantas siguen sin compartir XY, sección 7 del GDD de interiores) y `huella`. La búsqueda de hueco (`buscarHuecoConector`) evita muebles, la puerta propia de la sala y otros conectores ya reservados en la misma sala; si la huella del conector "de catálogo" (según riqueza) no cabe, cae en cascada a huellas más pequeñas (`escalera_vertical`, `trampilla`, ambas 1×1) antes de rendirse — sin esto, una sala pequeña o ya llena de muebles se quedaba sin conector y la planta quedaba inalcanzable por completo (bug real: un castillo de 4 plantas sacaba solo 2 de los 3 conectores que necesitaba).
- **`server/src/mundo/interiorColision.ts`**: `cargarInterior(ruta, nivel)` ahora selecciona la planta por `nivel` explícito (nunca `plantas[0]` ni "siempre planta_baja"), y expone `conectores: ConectorInteractivo[]` — los conectores que tocan ESA planta, cada uno con su casilla, su `destinoNivel` y `entradaDestino` (la casilla del OTRO lado, ya en la rejilla del piso destino — no reaparece en la coordenada del piso de origen, que en el destino podía caer dentro de una pared: bug real encontrado y corregido en esta misma tanda).
- **`server/src/rooms/InteriorRoom.ts`**: una room por `edificio`+`nivel` (`filterBy(["mapaId","edificio","nivel"])`). `"portal:usar"` primero busca un conector cerca (radio 2.2, igual que el resto de puertas del sistema) → manda `portal:ir {tipo:"interior", nivel:destinoNivel, x,y: entradaDestino}`, que es el MISMO mensaje que ya usaba una puerta exterior, así el cliente no necesita un caso nuevo. Si no hay conector cerca: `rol==="planta_baja"` → sale del edificio (`volver`, comportamiento de antes); cualquier otro piso → `portal:error` ("hay que usar la escalera") — regla explícita del streamer: solo puertas exteriores y escaleras son TP, nunca una salida directa saltándose los pisos.
- **Cliente** (`game.ts`, `interiorVisual.ts`): nuevo parámetro de URL `nivel` (por defecto 0); `crearInteriorVisual(interior, nivel)` pinta solo esa planta más un marcador propio (caja color `#c9a227`, distinto de cualquier mueble) en cada escalera/trampilla que la toque. El handler de `portal:ir` distingue "vengo de una escalera del mismo edificio" (conserva `origenSala`/`puertaX/Y` de la URL actual, solo cambia `nivel` y aparece en `entradaX/Y`) de "vengo de una puerta exterior" (comportamiento de antes, sin tocar).
- **Test de regresión** (`server/test/interiorColision.test.ts`, +4 tests, 37 en total): edificios con planta(s) alta(s)/bodega GARANTIZADAS (`castillo`, `torre_mago`, `faro`, `torre_militar`, `posada` — a diferencia de la lista multi-sala original, aquí siempre hay más de una planta que probar) cubren (1) todas las salas de CADA planta alcanzables desde su propio spawn, no solo la baja, (2) cada conector cae en una casilla real dentro de su rejilla y no sólida, (3) el nivel destino que expone cada planta coincide con `conectoresVerticales`.
- **Verificado visualmente**: bake real de un `castillo` (4 plantas: bodega + baja + 2 altas) vía `ciudades/`, servidor+cliente reales, Playwright caminando (con BFS sobre la MISMA rejilla que carga el servidor, la dirección diagonal simple se atasca en un laberinto de esta complejidad) hasta la escalera de planta baja, pulsando F: cambia de room, la URL pasa a `nivel=1`, el jugador aparece exactamente en la casilla centro del conector del piso de arriba (capturas en `client/test/capturas_escaleras/`, gitignored — script reutilizable en `client/test/prueba_visual_escaleras.cjs`).
- Regresión completa en verde tras el cambio: server 37/37, interiores 32/32, tsc limpio en server y cliente.

## Qué falta (pendiente, no bloquea)

- **Integración con el mapa principal de producción**: hoy NINGÚN portal "exterior" del mapa principal (`assets/mapas/principal/`) tiene `destino` configurado — los 120 POIs no están enlazados a instancias todavía. Esto es trabajo de `baker/` (decidir cómo un POI del mapa grande referencia su `mapaId` de región) y una decisión del streamer, no algo que tocar sin permiso (CLAUDE.md). Se probó con un mapa de prueba (`assets/mapas/hub_test/`, copia del demo con un portal añadido a mano) — gitignored, no es parte del juego real.
- **Transición sin recarga de página**: la recarga es simple y robusta pero corta la música/el estado de UI. Un loading screen propio que reconstruya la escena en caliente es una mejora futura.
- **Interiores: sigue sin techo** — paredes y suelo por planta ya funcionan (incluida la selección de planta), pero no hay geometría de techo/suelo del piso de arriba, así que desde fuera se vería un edificio hueco. Pendiente de un pase de render específico.
- **Paredes sin oclusión dinámica**: hoy se ven TODAS siempre (casa de muñecas desde fuera). Un render estilo Project Zomboid (la pared que da a cámara desaparece, la de fondo se ve) es trabajo de cámara/raycasting en el cliente, pendiente aparte.
- **Huella exterior vs. render**: la caja 3D ya coincide en POSICIÓN con "solar_edificio" (arreglado arriba); queda pendiente confirmar si el margen de tierra roja visible alrededor de algunas casas en las capturas es un "patio"/solar deliberadamente más grande que la caja, o un resto de desalineación de tamaño — a revisar con más capturas si sigue pareciendo raro.
- **"Volver" es de un solo nivel**: interior→región→hub funciona porque el cliente guarda `origenSala`/`puertaX/Y` en la URL, pero no hay una pila general (hub→región A→región B→interior→... siempre vuelve al nivel inmediato conocido, nunca más atrás). Suficiente para el caso de uso actual (Hub → aldea → edificio), pero a revisar si se encadenan más niveles.
- **El nombre del jugador no sobrevive la recarga** salvo que se pase por `?nombre=`: cada cruce de puerta genera un `Viewer-NNN` nuevo si no se preserva el parámetro. Menor, pendiente de que exista login/sesión real.
