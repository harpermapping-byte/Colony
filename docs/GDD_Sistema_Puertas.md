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
`interiorVisual.ts` dibuja las 4 paredes de cada sala casilla a casilla, con hueco exacto en cada `puertaConexion` real. **Oclusión dinámica + luz ambiente: HECHO (2026-08-30)**, ver `docs/Backlog_Mecanicas_Futuras.md` "Cono/campo de visión real en interiores" y "Luz ambiente por hora del día en interiores" — antes se veían TODAS las paredes siempre (casa de muñecas), ver abajo el alcance exacto de lo resuelto.

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

## Objetos de pared/techo y parpadeo de luces (RESUELTO, 2026-08-28)

Dos bugs reportados por el usuario tras revisar capturas de una aldea bakeada:

- **`interiorVisual.ts` nunca leía `resultado.colgados`/`resultado.techo`**:
  `colocarSala()` (interiores/src/colocarElementos.js) ya bakeaba cuadros,
  tapices, candelabros/antorchas de pared, faroles, etc. en esos dos arrays
  (y el editor de interiores/gui/vista3d.js sí los pintaba), pero el render
  del cliente en vivo solo iteraba `resultado.colocados` (mobiliario de
  suelo) — las paredes quedaban desnudas en el juego real aunque el editor
  las mostrara. Se añadió el bucle que faltaba, con la misma fórmula de
  posición por `lado` (norte/sur/este/oeste) que ya usaba el visor del
  editor, más un tercer bucle para `techo` (lámparas de araña, sin
  posición propia — se centran en la sala).
- **Mobiliario no cuadrado rotado 90°/270° sobresalía del hueco reservado**:
  `item.ancho`/`item.largo` que llegan del bake ya son la huella ROTADA
  (colocarElementos.js las calcula con `rotarHuella` antes de reservar
  sitio), pero el placeholder del cliente construía la caja con esas
  dimensiones YA rotadas y encima le aplicaba `rotation.y = item.rotacion`
  — una segunda rotación que la hacía sobresalir del cuadrado de suelo
  (visible sobre todo en estanterías/mesas de trabajo pegadas a un muro
  este/oeste). Arreglado deshaciendo el intercambio ancho/largo antes de
  construir la caja (rotarHuella es su propia inversa en 90/270), verificado
  analíticamente para 5 huellas × 4 rotaciones (0 fallos) — un `.glb` real
  no se ve afectado (no usa `dimensiones`, trae su propia geometría).
- **Luces de interior estáticas → parpadeo de antorcha real**: las luces de
  la capa "iluminacion" (suelo, pared o techo) ahora se devuelven desde
  `crearInteriorVisual()` junto al grupo (`{ grupo, luces }`) y quien llama
  las anima cada frame con el mismo `Math.sin(t*9+fase)` que ya usaba la
  antorcha del guardia nocturno, cada una con su propio desfase. Las
  farolas exteriores (`indice.luces`, antes sin consumir — ver
  GDD_Bakeador_POIs.md §6) se sumaron con el mismo criterio, apagadas de
  día.

Verificado: server tsc+test 62/62, client tsc limpio, interiores/ciudades/
poblacion 43/43 en verde tras el rebake de `assets/mapas/ciudad_demo/`.
E2E con Playwright: sin errores de consola, capa `capa:"iluminacion"`
confirmada en los `colgados` re-bakeados, y lectura en vivo de
`luz.intensity` (6 muestras cada 300ms) confirmando la oscilación real
tanto en interior (~1.05–1.53) como en farolas exteriores (~1.30–1.90).

## Ventanas reales, cono de visión y luz ambiente (RESUELTO, 2026-08-30)

Cierra dos pendientes del backlog (`docs/Backlog_Mecanicas_Futuras.md`, "Cono/campo de visión real en interiores" y "Luz ambiente por hora del día en interiores"), más un prerrequisito que ninguno de los dos tenía resuelto: `interiores/catalogo/ventanas.json` existía como combinatoria de catálogo desde el principio, pero **ninguna ventana se instanciaba nunca** — `colocarElementos.js`/`edificio.js` no las mencionaban en absoluto, así que `aporteLuz` era 0 siempre en la práctica.

**1. Ventanas reales (bakeador, `interiores/src/colocarElementos.js`)**: `colocarSala()` gana un parámetro `permiteVentanas` (default `true`) y genera de 1 a 3 ventanas (según riqueza) SIEMPRE (son estructura, ni `amueblado:"vacio"` las omite) en el muro **NORTE** de la sala — el único lado que, en el layout de fila de `generarPlanta` (edificio.js), nunca tiene puerta ni sala vecina (las filas crecen en X, alineadas por el muro sur), así que es el único del que se puede afirmar con certeza que da a fuera sin inventar un concepto de "fachada real" que este generador no tiene. `edificio.js` pone `permiteVentanas:false` en toda planta `rol:"bodega"` y en el pasillo dedicado de cada planta (su norte da a la fila de salas de encima, no a fuera). Cada ventana queda en `resultado.ventanas: [{x, lado:"norte", ancho, forma, tamano, marco, cristal, aporteLuz, colorDebug}]`, reservando su hueco en el mismo `bordesOcupados` que ya usan los colgados (para que una antorcha no se ponga encima). Fórmula de `aporteLuz` (antes solo descrita en prosa en §7bis, ahora real): `factorTamano × factorCristal`, con `factorTamano = tamano.aporteLuz` (solo tronera, su geometría no escala) o `anchoTiles × (altaEnPared ? 0.6 : 1)`, y `factorCristal = cristal.aporteLuz` (solo esmerilado) o `1`. Verificado: `interiores/test/catalogo.test.js` sigue en verde (73/73 tipologías, ninguna ventana rompe la generación real) más una comprobación manual de que bodega siempre da 0 ventanas y humilde/noble dan 1/3.

**2. Cono de visión (cliente, `client/src/render3d/conoVision.ts`)**: ver arriba, "Ampliación — coherencia bakeador↔render" (oclusión dinámica HECHO).

**3. Luz ambiente por hora del día (cliente, `client/src/render3d/luzInteriores.ts`)**: dos funciones puras, patrón "cero red" (igual que `tiempoMundo.ts`/`clima.ts`, `docs/GDD_Clima.md` §2 patrón A) — `nivelLuzExterior(hora)` interpola LUNA(0.15)→1.0→LUNA entre `horaAmanecer`/`horaAnochecer` (`assets/mundo/tiempo.json`) con `Math.sin`, y `luzAmbienteSala(hora, sumaAporteLuz)` = `nivelLuzExterior(hora) × √sumaAporteLuz` acotado a 1 — raíz cuadrada a propósito (rendimientos decrecientes: 4 ventanas de aporte 1 no cuadriplican, dan 2×) para que varias ventanas pequeñas no superen a una grande al mediodía, pedido explícito del backlog. Una sala sin ventana da 0 siempre. `interiorVisual.ts` crea una `THREE.PointLight` sintética por sala CON ventana (color frío 0xdfe8f5, alcance proporcional al tamaño de la sala, decay:1 para que no se note como un foco), actualizada cada frame por `actualizarLuzAmbiente(hora)` (mismo patrón que `actualizarVisibilidad`, expuesto en `crearInteriorVisual()`). **Simplificación documentada**: se SUMA a la luz de las antorchas (que siguen "siempre encendidas" a su intensidad fija, decisión ya tomada, no tocada aquí) en vez de tomar el MÁXIMO de ambas como pide el backlog al pie de la letra — con la intensidad de antorcha ya modesta, no se nota sobre-iluminado en la práctica, pero no es la fórmula exacta; pendiente de afinar si hiciera falta. Verificado: 8 tests de lógica pura (`client/test/luzInteriores.test.ts`) y visualmente con Playwright (`client/test/prueba_visual_luz_ambiente.cjs`, interior de prueba con ventanas reales en `assets/mapas/demo/interiores/prueba_luz_ambiente.json`, comparando `?hora=2` contra `?hora=12`).

**Documentos actualizados en el mismo cambio**: este documento, `docs/GDD_Bakeador_Interiores.md` §7bis (fórmula de `aporteLuz` real), `docs/Backlog_Mecanicas_Futuras.md` (ambas secciones cerradas).

## Qué falta (pendiente, no bloquea)

- **Integración con el mapa principal de producción — auditado a fondo 2026-09-03, la máquina YA existe, solo falta correrla**: hoy NINGÚN portal "exterior"/"interior" del mapa principal (`assets/mapas/principal/`) tiene `destino`/`edificio` configurado — los 121 POIs no están enlazados a instancias todavía. Esto NO es trabajo pendiente de código: `baker/src/instanciasPOI.js` (existe desde 2026-08-30, wireado en `baker/src/generar.js`) ya genera portales reales (`destino.mapaId` para POIs "asentamiento", `edificio`/`tipoEdificioId` para "edificio"/mazmorra-edificio/mazmorra-cueva), YA coloca la caja 3D visible del edificio (`t:"e"` en el sector, mismo render que el resto de props) o las rocas de boca de cueva, y YA anida `pois/<slug>/` (región ciudades/) + `interiores/` bajo la carpeta de salida — **verificado end-to-end en esta auditoría con un bake de prueba pequeño** (`baker/config/ejemplo-rapido.json` a una carpeta temporal): 8 POIs de categoría edificio/mazmorra/asentamiento de 9 colocados generaron sus 8 portales reales con datos correctos, 3 cajas 3D visibles y 2 bocas de cueva decoradas, sin ningún fallo. El motivo real del hueco: **`assets/mapas/principal/` es un bake VIEJO** (`indice.json`: `nombre:"Mapa Inicial"`, `semilla:"semilla-846109"`, bordes 4×mar_abierto) que ni siquiera coincide con `baker/config/mapa-principal.json` actual (`nombre:"mapa-principal"`, `semilla:"colonia-01"`, bordes mixtos) — se horneó ANTES de que existiera `instanciasPOI.js`, y nunca se ha rehorneado desde entonces (el mismo aviso ya documentado arriba en CLAUDE.md sobre el cambio a Perlin obligando a rehornear mapas viejos aplica aquí también). **Bug menor encontrado y corregido en la misma auditoría**: `baker/config/mapa-principal.json` tenía `carpetaSalida:"output/mapa-principal"` — el `mapaId` que habría quedado embebido en cada `destino.mapaId` de un POI "asentamiento" habría sido `"mapa-principal"`, pero la carpeta real desplegada es `assets/mapas/principal/` (basename `"principal"`, sin "mapa-"), lo que habría roto la resolución de esos portales en el servidor con un mismatch de nombre silencioso. Corregido a `carpetaSalida:"output/principal"` para que, en el próximo rebake real, el mapaId embebido coincida con la carpeta final. **Decisión pendiente del streamer, NO tocado sin permiso (CLAUDE.md, "los bakes grandes los corre el usuario")**: rehornear `assets/mapas/principal/` con el baker actual usando `baker/config/mapa-principal.json` reemplaza el mapa entero (ríos/biomas/POIs en posiciones nuevas — la semilla actual del bake viejo ni siquiera es la de la config actual), no es un parche incremental — hace falta el visto bueno explícito antes de correrlo (bake grande, ~70MB, tiempo real). Se probó en su día con un mapa de prueba a mano (`assets/mapas/hub_test/`, copia del demo con un portal añadido a mano) — gitignored, no es parte del juego real.
- **Transición sin recarga de página**: la recarga es simple y robusta pero corta la música/el estado de UI. Un loading screen propio que reconstruya la escena en caliente es una mejora futura.
- **Interiores: sigue sin techo** — paredes y suelo por planta ya funcionan (incluida la selección de planta), pero no hay geometría de techo/suelo del piso de arriba, así que desde fuera se vería un edificio hueco. Pendiente de un pase de render específico.
- ~~**Paredes sin oclusión dinámica**~~ **HECHO (2026-08-30)**, ver `client/src/render3d/conoVision.ts`: con la cámara isométrica FIJA (worldScene.ts, offset constante (+d,+d,+d)), las paredes este/sur de CUALQUIER sala son siempre las que dan a cámara — se ocultan en bloque para la sala que pisa el jugador, y en cascada a través de una puerta en su pared norte/oeste hacia la sala contigua (silueta del hueco = silueta de lo visible, backlog "Cono/campo de visión real en interiores"). **Granularidad de SALA completa en v1** — no recorta solo la porción visible de una sala grande a través de un hueco estrecho (eso sí sigue pendiente, ver `conoVision.ts` cabecera). Verificado visualmente con Playwright (`client/test/prueba_visual_cono_vision.cjs`) y con 7 tests de lógica pura (`client/test/conoVision.test.ts`).
- **Huella exterior vs. render**: la caja 3D ya coincide en POSICIÓN con "solar_edificio" (arreglado arriba); queda pendiente confirmar si el margen de tierra roja visible alrededor de algunas casas en las capturas es un "patio"/solar deliberadamente más grande que la caja, o un resto de desalineación de tamaño — a revisar con más capturas si sigue pareciendo raro.
- **"Volver" es de un solo nivel**: interior→región→hub funciona porque el cliente guarda `origenSala`/`puertaX/Y` en la URL, pero no hay una pila general (hub→región A→región B→interior→... siempre vuelve al nivel inmediato conocido, nunca más atrás). Suficiente para el caso de uso actual (Hub → aldea → edificio), pero a revisar si se encadenan más niveles.
- **El nombre del jugador no sobrevive la recarga** salvo que se pase por `?nombre=`: cada cruce de puerta genera un `Viewer-NNN` nuevo si no se preserva el parámetro. Menor, pendiente de que exista login/sesión real.
- **Cono de visión: solo granularidad de SALA completa** (`conoVision.ts`) — revela la sala vecina entera al cruzar una puerta norte/oeste, no recorta solo la porción visible de una sala grande a través de un hueco estrecho (el "recorte a la silueta real de la abertura" que describe el backlog al pie de la letra). Tampoco cruza puertas este/sur del jugador (esas paredes ya están siempre ocultas para su propia sala — ver el comentario de cabecera de `conoVision.ts` para el porqué).
- **Luz ambiente: se SUMA a las antorchas, no toma el MÁXIMO** (ver arriba, "Ventanas reales, cono de visión y luz ambiente") — simplificación deliberada, pendiente de afinar si en la práctica se ve sobre-iluminado.
- **Ventanas: sin arte real todavía** (`colorDebug` plano, `assets/exteriores`/`assets/interiores` no tienen ningún `.glb`/textura de ventana) — mismo estado que el resto del catálogo, arte placeholder a sustituir más adelante (CLAUDE.md regla 7).
