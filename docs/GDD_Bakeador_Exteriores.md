# Streamer Colony — Diseño del Bakeador de Exteriores

Documento de referencia con todo lo decidido sobre el bakeador de mapas exteriores (bosques, llanuras, territorios, etc.). No es el bakeador de interiores ni el de mazmorras/híbridos — esos son piezas aparte con sus propias reglas (ver sección 16). Tampoco es el mapa de la ciudad: ese es un **JPG pintado a mano por el streamer**, fijo y sin variación procedural — no usa tileset ni biomas, porque no lo genera este bakeador. El tileset y todo lo de este documento es específico de las zonas exteriores procedurales.

Filosofía general del proyecto: generar **una vez** (nunca en directo), **cálculo perezoso** para todo lo que cambia con el tiempo (nada corre en segundo plano), y **todo lo que existe en el mapa tiene un uso** (obligatorio en el catálogo). Diseñado para correr en infraestructura 100% gratuita (Render free + Colyseus, un solo proceso con muchas rooms/chunks).

## 1. Arquitectura de mundo

- El mundo no es un mapa único continuo: hay un **Hub** (ciudad, persistente), **instancias privadas** (interiores, parcelas, mazmorras) y **regiones exteriores con nombre** (ej. "Bosque Norte", "Llanura Central"), cada una su propia room/instancia con tope de jugadores.
- Cada región exterior se divide en **chunks de 32x32 casillas** — solo se cargan en memoria los chunks cercanos a jugadores activos (streaming tipo Minecraft); el resto no cuesta nada.
- Cada mapa exterior puede ser **muy grande** (recorrerlo de borde a borde puede tardar 5-10 minutos andando; cientos de chunks de lado) sin coste extra en vivo, porque el coste depende de cuánto está cargado ahora, no del tamaño total.
- **Bordes de mapa**: cada borde (norte/sur/este/oeste, o los que tenga) se etiqueta como `cerrado` (fin del mundo, ej. montaña/bosque impenetrable), `mar abierto` o `tierra abierta` (puede conectar a otro mapa horneado aparte, estilo Valheim — expansión futura tipo DLC sin retocar los mapas existentes). Cada borde tiene nombre propio, registrado en el catálogo, para poder enlazarlo más adelante sin rehacer nada.
- Un borde abierto sin mapa enlazado todavía se comporta como un límite temporal (no deja avanzar), no como un error.

## 2. Terreno base (independiente del arte visual)

- **Rejilla de tipo de terreno**: capa lógica (césped, tierra, arena, roca, agua, nieve...) separada del JPG/tileset visual — es la fuente de verdad para mecánicas. No es solo para hornear: **el servidor la consulta en vivo** en todo momento (un jugador se mueve → se mira su bonus; un objeto cae al suelo → se mira si puede caer ahí; se interactúa con el suelo → se mira qué acciones tiene sentido ofrecer) — cada chunk cargado mantiene esta rejilla en memoria para consulta O(1), sin coste de red.
- Cada tipo de terreno en el catálogo define: si es transitable, modificador de velocidad de movimiento (caminos = bonus, nieve/roca = penalización — este modificador es el mismo dato que usará cualquier futura montura, solo con su propio multiplicador aparte), y **estratigrafía** (qué terreno queda expuesto si se cava ahí — césped → tierra → roca, por ejemplo).
- **Solo son "tipo de terreno" las superficies que cambian la jugabilidad** (transitabilidad, velocidad, bioma). El detalle decorativo (hojas sueltas, ramitas, piedrecitas) **nunca** es un tipo de terreno nuevo — son objetos de la capa de vegetación/recursos (sección 5) colocados encima de un terreno normal. Esto evita que la lista de terrenos se dispare y evita el problema de tener que dibujar una transición para cada par de tipos (ver regla de mezcla en la sección 3).
- Existe un **suelo mínimo cavable** por región/bioma (equivalente al bedrock de Minecraft) para que cavar no rompa el mapa.
- **Cavar** es un sistema de delta (igual que talar un árbol): se guarda solo el cambio puntual, no se regenera nada. El sistema de acantilados (ver siguiente punto) ya cubre visualmente el hueco que deja cavar, sin reglas nuevas.
- **Elevación en niveles discretos** (6-10 bandas: agua profunda, nivel de agua, llanura, colinas, montaña, cumbre inaccesible). Un salto de más de un nivel entre casillas vecinas genera automáticamente un acantilado infranqueable (salvo rampa/escalera puesta por el bakeador) — esto da fronteras naturales entre zonas y el aspecto 2.5D "terraceado" a la vez.

## 3. Generación de biomas

- Ruido de baja frecuencia con **5 parámetros** (inspirado en el sistema moderno de Minecraft): elevación, temperatura, humedad, **continentalidad** (distancia a costa, independiente de la elevación) y **"rareza"** (permite combinaciones inesperadas y controladas, ej. selva sobre montaña).
- Parámetros extra opcionales inspirados en Dwarf Fortress: **drenaje** (dónde se forman lagos/pantanos de forma más natural que solo por pendiente) y **vulcanismo** (zonas volcánicas/geotérmicas como bioma peligroso extra).
- **Domain warping**: se distorsionan las coordenadas antes de leer el ruido — rompe el aspecto "ondulado reconocible" del ruido puro y da formas mucho más orgánicas a costas/fronteras de bioma.
- **Voronoi** para decidir primero las macro-formas de región (qué mitad del mapa tiende a qué bioma) antes de aplicar el ruido fino de detalle — da un mapa más "legible" a gran escala sin perder lo orgánico en detalle.
- **Suavizado por autómata celular**: pasada de limpieza que elimina "salpicaduras" (celdas sueltas de un bioma en medio de otro), dando fronteras con formas naturales.
- **Reglas de vecindad entre biomas**: qué biomas pueden tocarse directamente y cuáles necesitan un bioma de transición en medio (evita, ej., desierto pegado a pantano sin sentido).
- **Bordes/costas con detalle fractal a varias escalas** (ondulación grande + ondulación fina encima), no una sola escala de ruido.
- **Mezcla de terrenos por capas con prioridad, no por pares**: cada tipo de terreno se pinta como una capa con un borde difuminado orgánico propio (1 textura + 1 máscara de borde), apiladas por prioridad (ej. arena de base, tierra encima, césped encima de esa). Así cualquier combinación entre dos tipos cualesquiera queda bien sin tener que dibujar una transición específica para cada par — evita la explosión combinatoria de piezas de arte.
- **Considerado y descartado por ahora**: un boceto de biomas pintado a mano por el streamer como entrada del bakeador (en vez de puro ruido/parámetros). Se decidió empezar solo con parámetros por ser más simple e iterable; queda como posible capa opcional a añadir más adelante sin romper nada de lo ya construido.
- **Reglas de colocación en dos niveles**: elementos discretos/importantes (POIs, parcelas, zona segura) usan reglas **duras** por radio/distancia; el relleno ambiental (biomas, vegetación, caminos) usa reglas **blandas**/procedurales por ruido — nunca al revés, para que lo importante tenga sentido y lo ambiental se vea orgánico.
- **Reskin estacional** (4 estaciones): cambia qué textura usa cada terreno/planta (visual, gratis) y qué entradas del catálogo son válidas ahora mismo (lógico — un recurso puede estar etiquetado "solo otoño", filtra el pool de spawn sin regenerar nada). La estación se calcula con la misma fórmula barata que la hora solar compartida.

### 3.1. Tabla de clasificación de bioma (valores de referencia, 0=mínimo, 1=máximo)

Valores de partida para el mapa inicial — ajustables desde el catálogo de configuración sin tocar el algoritmo:

| Bioma | Temperatura | Humedad | Elevación (banda) | Continentalidad | Notas |
|---|---|---|---|---|---|
| Pradera Central | 0.4 – 0.6 | 0.4 – 0.6 | 2 – 3 | alta (interior) | bioma inicial/seguro |
| Bosque | 0.4 – 0.6 | 0.6 – 0.8 | 2 – 4 | media-alta | — |
| Montaña Nevada | 0.0 – 0.2 | cualquiera | 6 – 7 | cualquiera | borde norte cerrado |
| Desierto | 0.8 – 1.0 | 0.0 – 0.2 | 1 – 3 | media | — |
| Costa/Playa | cualquiera | cualquiera | 1 – 2 | muy baja (borde de costa) | franja de transición, no compite por área con los demás |
| Pantano | 0.5 – 0.7 | 0.8 – 1.0 | 1 – 2 | media | requiere drenaje bajo |
| Tierras Quemadas | cualquiera | baja | cualquiera | cualquiera | activado por vulcanismo alto, no por el rombo temperatura/humedad — puede aparecer como bolsa dentro de Montaña o Desierto |

El parámetro de **"rareza"** puede saltarse estas reglas con probabilidad baja (la combinación inesperada y controlada que ya mencionamos, ej. un oasis de humedad en pleno desierto fuera de las zonas de agua horneadas).

## 4. Hidrología

- **Ríos/lagos/cascadas/desembocaduras**: se hornean una sola vez con un algoritmo de "seguir la pendiente" (o su versión mejorada, **erosión hidráulica por partículas**, que además esculpe el relieve real en vez de solo marcar tiles de agua — más realista, sigue siendo gratis porque se calcula una sola vez offline).
- El caudal de cada tramo se guarda como dato — decide dónde hay cascada, y sirve para que los **molinos de agua** generen energía leyendo ese número (sin simular física de fluidos).
- **Relleno reactivo tipo Minecraft**: si alguien cava cerca de agua existente, se dispara un relleno acotado (máx. 6-8 casillas), calculado una sola vez en el momento del cambio — nunca una simulación continua.
- **Zonas inundables** cerca de ríos: casillas bajas junto al cauce que, con lluvia sostenida por encima de un umbral de tiempo, pasan a inundarse temporalmente (mismo mecanismo de acumulación que la nieve/charcos, sección 8).
- Detalles de acabado del agua: barras de sedimento en curvas, playones/islas en tramos anchos y lentos, lecho visible en época seca, cascadas congeladas en invierno sostenido, niebla sobre el agua al amanecer, reflejo/tono según hora del día (cálculo en vivo, sin coste).

## 5. Vegetación y recursos (capa de objetos)

- Cada categoría (césped, flores, hojas, setas, rocas, minerales...) usa su **propio mapa de calor derivado** de `(bioma, terreno, elevación)`, con **ruido independiente por categoría** (distinta semilla/escala) para que no se agrupen todas igual — así salen claros, manchas de flores, zonas de piedrecitas sueltas, en vez de un "mar" uniforme.
- **Capas que influyen en otras**: la densidad de árboles genera un mapa de sombra derivado que aumenta la probabilidad de setas y reduce la de flores en esas zonas — coherencia ecológica gratis, sin diseñarlo a mano.
- **Variantes reales por tipo** (8 modelos de roca, 4 de pino, 5 de abeto...) elegidas al azar por instancia, **combinadas con transformación individual** (rotación, escala, espejo) — evita que se vea todo como copias idénticas. Un solo placeholder por variante en la carpeta de arte, sustituible más adelante.
- **Sistema de pool de recursos** (estilo WoW): más posiciones candidatas de las que están activas a la vez (ej. 50 posibles vetas, 20 activas al azar) — da sensación de exploración en vez de recursos siempre en el mismo sitio.
- **Regeneración perezosa**: cuando se agota un recurso, no hay temporizador corriendo — se calcula al vuelo, la próxima vez que se consulta, si ya ha pasado suficiente tiempo real para que vuelva a estar disponible.
- Decidir por tipo de recurso si es **compartido** (el primero que lo agota, se acabó para todos) o **por-jugador** (cada uno tiene su copia) — importante con mucha gente conectada a la vez.
- **Regla obligatoria de catálogo**: ninguna entrada nueva se registra sin declarar al menos un uso — nada existe solo de adorno.
- Vegetación con memoria de sí misma: flores que aumentan su propia densidad cerca de otras flores (parches auto-reforzados en vez de puntos sueltos).

## 6. Puntos de interés (POIs)

- Dos tipos: **integrados** (viven directamente en los datos del propio mapa exterior, sin transición — un oasis, unas ruinas) y **portal** (un disparador pequeño en el exterior que enlaza a una instancia real aparte — cueva → mazmorra, puerta de aldea → interior de la aldea). Los portales pueden llevar además una "fachada" puramente visual (tejados asomando sobre una empalizada) que no es la instancia real, solo ambientación.
- Colocación con **muestreo por disco de Poisson** (separación mínima, sin amontonar) y **pool de plantillas por bioma** con regla anti-repetición (no la misma variante dos veces seguidas cerca).
- **Variantes legendarias**: con probabilidad muy baja, en vez de una plantilla normal del pool, aparece una versión única diseñada a mano — momentos de sorpresa real.
- **Reglas de sitio lógico**: cada tipo de POI declara dónde tiene sentido estar (aldea cerca de agua dulce y terreno llano; torre de vigía en alto con visibilidad; mazmorra cerca de montaña/cueva) — no solo "hay hueco aquí".
- **Escenas narrativas menores (vignettes)**: grupos pequeños de objetos con historia implícita (carreta volcada, choza abandonada), mismo mecanismo que los POIs grandes pero más frecuente y con menos restricciones de espacio.
- La naturaleza "reclama" las ruinas: más vegetación silvestre alrededor de estructuras abandonadas.

## 7. Caminos

- Trazados con **A\*** entre puntos importantes (ciudades, POIs grandes), siguiendo el terreno de forma natural, evitando agua/acantilados salvo puente.
- Dan **bonus de velocidad** al andar por ellos (como cualquier tipo de terreno en la tabla de modificadores).
- **Desgaste visual** según distancia a la ciudad más cercana (más ancho/trillado cerca, sendero apenas marcado lejos) — reutiliza el mismo dato de distancia que el gradiente de peligro.
- **Puentes automáticos** donde un camino cruza un río (intersección de datos ya calculados).
- Hitos/señales en cruces, refugios de descanso en tramos muy largos entre ciudades.
- **Sendas de animales** (además de los caminos principales): rutas finas entre fuentes de agua y zonas de mucha fauna, mismo algoritmo a menor escala.
- Caminos que llevan a un borde de mapa cerrado/sin conectar se ven más abandonados — refuerzo visual de "aquí no hay nada todavía".

## 8. Clima, ciclos y acumulación

- **Hora solar compartida**: fórmula sobre el reloj real, sin coordinación entre servidores, cero coste — cada región decide su propio clima por encima de esa misma hora base.
- **Viento**: se prepara como otra variable más del mismo sistema de estado climático (dirección + fuerza) — no requiere nada nuevo del bakeador ahora, listo para cuando se diseñe a fondo.
- **Sistema de acumulación** (mecanismo genérico, reutilizado para todo lo siguiente): un valor por región que tiende hacia un objetivo según el clima actual, calculado bajo demanda (nunca corriendo en segundo plano) con la fórmula "tiempo transcurrido × velocidad de cambio según el clima". Aplicaciones: profundidad de nieve acumulada, tamaño de charcos, barro en caminos (reduce temporalmente su bonus de velocidad), caudal extra en ríos durante tormentas (más energía en los molinos), hielo en agua quieta con frío sostenido.
- Efectos visuales derivados del mismo dato de "humedad actual" combinado (bioma + lluvia reciente + cercanía al agua): mojado temporal del suelo, niebla en valles húmedos al amanecer, moho en rocas según humedad del bioma.

### 8.1. Constantes de calendario (valores de referencia, configurables)

- 1 día de juego completo ≈ 30 minutos reales (día/noche dentro de ese ciclo, ej. 20 min de día + 10 min de noche).
- 1 estación ≈ 7 días de juego.
- 1 año de juego = 4 estaciones ≈ 28 días de juego (~14 horas reales).
- Todo esto vive en el catálogo de configuración, no en código — se puede acelerar/ralentizar el reloj entero cambiando un solo número, y cualquier sistema que dependa del tiempo (acumulación, regeneración de recursos, estaciones) se ajusta solo porque todos leen la misma fórmula compartida.

## 9. Fauna

- Tablas de spawn por `(bioma, elevación, estación)` — igual que la vegetación.
- El bakeador solo decide la **población inicial y capacidad máxima** por especie y región (ej. "Bosque Norte nace con 20 conejos, tope 40"). Todo lo de reproducción, caza y extinción real es un sistema de juego aparte (fuera del bakeador) que usará estos mismos números como semilla.
- Migración estacional: algunas especies reducen su densidad o desaparecen en ciertas estaciones.
- Ecosistema simple por reglas de spawn (más depredadores donde hay más presas cerca), sin simular persecuciones.

## 10. Peligro, zonas seguras y parcelas

- **Radio duro de zona segura** alrededor de cada ciudad: dentro de él no spawnean enemigos peligrosos.
- **Gradiente de peligro** continuo (no a saltos) por distancia a la ciudad más cercana y, dentro del propio mapa, por distancia al centro (estilo Valheim) — se suma al salto de dificultad entre mapas conectados distintos.
- Campamentos hostiles con más probabilidad cerca de caminos (lógica de emboscada).
- **Parcelas edificables**: mismo pipeline de POIs (Poisson-disc), pero con restricciones extra — dentro de zona segura, sin pisar caminos ni otras estructuras, tamaños S/M/L, alrededor de ciudades (actuales o futuras).

## 11. Profundidad visual 2.5D

- **Y-sorting**: cada objeto colocado guarda su punto de anclaje en el suelo (no el centro del sprite), para que el motor dibuje correctamente qué pasa por delante/detrás de qué.
- Cada estructura/árbol grande guarda su **altura**, usada en vivo (no horneada) para calcular la dirección/largo de su sombra según el ángulo del sol del reloj compartido — nubes futuras funcionarían igual, en vivo.
- Elementos de profundidad en el propio terreno (salientes de roca, huecos por detrás) sin ser instancias — mismo sistema de estructuras, con marca de "tiene parte delantera y trasera".
- Erosión/escombros en la base de los acantilados para vender mejor el cambio de altura.
- Marcas de erosión (roca/tierra expuesta) en pendientes muy pronunciadas.

## 11.5. Detalles de acabado — lista completa de auditoría

Todos siguen el mismo principio (sección 14): fórmula barata sobre datos que el bakeador ya calcula, nunca simulación nueva. Se listan aquí de forma exhaustiva para no perder ninguno tras las rondas de "más ideas" de la sesión de diseño.

**Vetas y minería** (usan elevación + estratigrafía, sección 2): las vetas siguen forma de filón alargado (ruido direccional), no manchas redondas; los materiales más raros solo aparecen cavando más profundo; fragmentos sueltos en superficie insinúan una veta rica debajo.

**Rocas y superficies** (usan humedad/bioma): variante de roca (musgosa/seca/agrietada) ponderada por la humedad del bioma en vez de puramente al azar.

**POIs con más lógica** (usan caminos + elevación + agua): torres/fortines con visibilidad mutua o hacia la ciudad; pozos de agua automáticos en asentamientos sin río cerca; muelles automáticos en asentamientos junto a un río.

**Caminos** (usan el grafo de A\*): marcador/hito automático en cada cruce.

**Estructuras y sombra** (usan altura + Y-sorting, sección 11): la sombra de un edificio reduce la vegetación justo debajo, igual que el dosel de los árboles.

**Bordes de mapa** (usan el tipo de borde, sección 1): los bordes cerrados llevan más densidad de detalle justo en el límite para reforzar que es un muro real; los bordes de mar sin conectar todavía muestran una bruma en el horizonte, sugiriendo mundo más allá sin poder llegar.

**Microterreno costero**: pequeñas pozas de marea en la franja entre playa y mar; posibles salitrales/lechos secos en desierto donde la elevación diría "aquí se acumularía agua" pero casi nunca llueve (mismo cálculo que las zonas inundables, resultado distinto).

**Vegetación estacional** (usan densidad de árboles ya colocada + estación): hojarasca de otoño más densa cerca de árboles de hoja caduca.

**Detalles narrativos raros**: cicatrices de rayo (permanentes, poco frecuentes) en llanuras abiertas durante tormentas; tocones y restos con segundo uso (raíces/hongos excavables, material de construcción rústico — refuerza la regla de "nada sin uso" hasta en los subproductos).

**Estructuras naturales menores**: troncos caídos como puentes naturales entre bosque denso y ríos estrechos; hormigueros/termiteros como estructura decorativa menor en pradera.

**Fauna ambiental**: bandadas migratorias sobrevolando en primavera/otoño (puro adorno visual); insectos/luciérnagas cerca de agua estancada en noches de verano; escarcha en estructuras/rocas por las mañanas frías (aparte de la nieve del suelo, mismo mecanismo de acumulación).

## 12. Herramientas del bakeador

- **Visor con cámara libre** ("volar" por el mapa), con el mismo sistema de carga por chunks que el juego real (solo se cargan los chunks cercanos a la cámara) — valida la misma pieza que usará el juego en producción.
- **Modo de visualización en colores de depuración**: tipo de terreno como color plano, cada categoría de decoración como puntitos de otro color según su densidad — permite revisar el resultado antes de tener arte real, con opción de aislar una sola capa.
- **Pasada de validación automática** al terminar de hornear: comprueba que todas las ciudades estén conectadas por camino, que no haya zonas completamente aisladas, etc.
- **Reglas de terreno definidas antes de generar** (no solo validadas después): qué es transitable, qué quema, qué hunde — el bakeador las respeta mientras coloca cosas, en vez de descubrir el problema al final.

## 12.5. Catálogo de contenido en dos niveles — especies vs. recursos

Principio fijado, aplica a vegetación y fauna por igual:

- **Nivel de recursos** (pequeño, fijo, es lo único que ve la economía/crafteo): un puñado de categorías de materiales. Añadir una especie nueva nunca añade una categoría de recurso nueva.
- **Nivel de especies** (grande, sin límite real — objetivo de referencia: ~100 tipos de árbol, ~200 tipos de animal): cada especie es una ficha de contenido (nombre real, sprite, reglas de bioma/spawn) que **apunta a una de las categorías de recurso** de arriba. Así hay variedad visual y de exploración enorme sin que la economía se vuelva inmanejable.
- **Los nombres de especie son siempre reales** (roble, lobo, camello...), nunca inventados — lo fantástico/único queda reservado para las variantes legendarias raras de POIs, que son otra pieza distinta.
- Rellenar el listado completo de las ~300 especies es tarea de contenido aparte, no bloquea el diseño — se hace por biomas, según convenga.

### Categorías de recurso — madera

Madera Blanda · Madera Dura · Madera de Abedul · Madera de Sauce (flexible, cestería) · Madera de Palmera (exótica) · Madera Carbonizada (bioma quemado)

### Categorías de recurso — carne

Carne Roja · Carne Blanca · Carne de Caza Mayor · Carne Exótica · Pescado de Río · Pescado de Mar · Marisco

### Categorías de recurso — cuero/piel

Piel Basta · Piel Fina · Piel de Invierno · Piel Exótica · Cuero de Reptil · Cuero Grueso (jabalí y similares)

### Categorías de recurso — mineral/piedra

Piedra Común · Pedernal · Arcilla · Hierro · Cobre · Plata · Oro · Obsidiana · Azufre · Gema (legendario/raro)

### Categorías de recurso — plantas/hierbas (pensando en alquimia futura)

Hierba Curativa · Hierba Venenosa · Hierba Aromática · Flor Medicinal · Hongo Medicinal · Raíz · Fibra Vegetal

## 12.6. Orden de ejecución del pipeline (referencia rápida)

1. **Ruido base** (elevación, temperatura, humedad, continentalidad, rareza + drenaje/vulcanismo).
2. **Clasificación de bioma** contra la tabla de la sección 3.1 (técnica: diagrama de Whittaker, la usa Dwarf Fortress; Minecraft usa la variante de 5 parámetros).
3. **Suavizado** por autómata celular (limpia salpicaduras, técnica que usa Minecraft).
4. **Hidrología**: erosión hidráulica por partículas → ríos/lagos/cascadas/desembocaduras.
5. **Colocación de POIs y parcelas**: muestreo por disco de Poisson + pool de plantillas por bioma.
6. **Decoración/mapas de calor**: vegetación, rocas, fauna inicial.
7. **Caminos**: A\* entre puntos importantes.
8. **Bordes del mapa**: etiquetado (cerrado/mar abierto/tierra abierta) + nombre para el catálogo.
9. **Exportado por chunks**: un archivo por chunk + índice con versión (sección 18).
10. **Validación automática** (sección 12): conectividad, zonas alcanzables.

## 13. Catálogo (obligatorio en todo el proyecto, no solo el bakeador)

- **Catálogo de contenido**: qué es cada cosa (árbol, roca, animal, estructura) — el bakeador solo coloca referencias por nombre a este catálogo, nunca datos "a fuego". Esto permite hornear mapas con cosas (ej. "camello", "mercader") antes de que exista su mecánica — al registrarse en el catálogo más adelante, cobran vida automáticamente en todos los mapas ya horneados, sin regenerar nada.
- **Catálogo de configuración/números**: aparte del de contenido — radios de zona segura, tiempos de regeneración, tamaño de pools, velocidades, densidades... todos los valores ajustables en un único sitio, sin tocar código.
- Mismo principio aplicable a textos/diálogos cuando lleguemos ahí.

## 14. Optimización — por qué esto no revienta un servidor gratuito

- Cada capa de detalle es una fórmula sobre datos ya calculados (elevación, humedad, distancia, hora), no una simulación nueva — el coste no crece aunque crezca el número de capas.
- Todo lo que cambia con el tiempo usa cálculo perezoso (se resuelve solo cuando se consulta, nunca hay nada "corriendo" de fondo).
- Solo cuesta RAM/CPU lo que está cerca de jugadores activos ahora mismo (chunks + rooms), nunca el tamaño total del mundo.
- Muchas capas comparten la misma infraestructura de ruido y los mismos valores derivados (ej. "humedad actual de esta casilla") en vez de recalcular cada una por separado.

## 15. Pendiente de definir (siguiente tarea, no bloquea el diseño del bakeador)

- Listado completo de especies reales (~100 árboles, ~200 animales, objetivo de referencia) por bioma, cada una etiquetada con su categoría de recurso del nivel dos (sección 12.5) — es rellenar el catálogo, no diseño de algoritmo. Se puede hacer por tandas, un bioma a la vez.
- Nombres de zonas/regiones del mapa (cuando el mapa esté trazado completo).
- Sistema de fertilidad del suelo para granjas (mecánica de juego, no del bakeador).
- Zonas de ambiente sonoro/partículas por bioma (dato a rellenar, mecanismo ya definido).
- **Niebla de guerra / descubrimiento del mapa** (mecánica de jugador, no bakeador): reutilizará el propio sistema de chunks — guardar por jugador qué chunks ha visitado alguna vez da minimapa progresivo casi gratis.
- **Viaje rápido al descubrir un POI** (mecánica de jugador, no bakeador): descubrir un POI importante lo desbloquea como punto de teletransporte — conecta con el punto anterior.

## 16. Fuera del alcance de este bakeador (piezas aparte)

- **Bakeador de interiores**: usará Wave Function Collapse (coherencia de reglas locales, ideal para habitaciones/edificios).
- **Bakeador de mazmorras/híbridos**: usará BSP (mazmorras "construidas", habitaciones+pasillos) o autómata celular (cuevas naturales) según el tipo. Este bakeador de exteriores solo coloca la puerta/enlace hacia ellas, nunca su contenido.

## 17. Esquema de campos del catálogo (por tipo de entrada)

Referencia canónica — todo lo que se ha ido mencionando a lo largo del diseño, consolidado aquí para que al construir el catálogo no falte nada. Todas las entradas comparten `id` (nombre único, real cuando aplique) y `categoria` (a qué tabla pertenece).

**Entrada de tipo de terreno:**
`transitable` · `modificador_velocidad` · `quema` (bool) · `requiere_nadar` (bool) · `estratigrafia` (id del terreno expuesto al cavar un nivel) · `textura_base` (tileset) · `variantes_temporales` (mojado, escarcha, nieve — activadas por clima, no horneadas)

**Entrada de especie de vegetación/recurso:**
`categoria_recurso` (referencia al nivel 2, sección 12.5) · `biomas_validos` · `bandas_elevacion_validas` · `estaciones_validas` (vacío = todo el año) · `variantes_arte` (lista, mínimo 1) · `permite_transformacion` (rotación/escala/espejo) · `densidad_base` / `escala_ruido` / `agrupamiento` (parámetros del mapa de calor, en catálogo de configuración) · `recolectable_por` (herramienta/mecánica) · `rendimiento` (cantidad + categoría de recurso) · `tiempo_regeneracion` · `contencion` (`compartido` / `por_jugador`) · `punto_anclaje` (Y-sorting) · `altura` (para sombra) · **`uso`** (obligatorio, texto libre — para qué sirve; sin esto la entrada no se acepta)

**Entrada de estructura/POI:**
`tipo` (`integrado` / `portal`) · `biomas_validos` · `reglas_de_sitio` (cerca de agua, terreno llano, visibilidad...) · `separacion_minima` · `variantes` (pool, incluida posible variante `legendaria` con probabilidad baja) · `contenido` (integrado: lista de sub-elementos que estampa; portal: referencia al mapa/instancia destino) · `punto_anclaje` · `altura`

**Entrada de animal:**
`categoria_recurso_carne` · `categoria_recurso_piel` · `biomas_validos` · `bandas_elevacion_validas` · `estaciones_validas` · `poblacion_inicial` / `capacidad_maxima` (por región, lo único que decide el bakeador) · `peligroso` (bool) · `domesticable` (bool) · `variantes_arte`

**Variantes de color/patrón, dentro del mismo `variantes_arte`**: la forma más barata de dar sensación de variedad — una gallina blanca, negra, marrón o gris no son 4 especies distintas, es **1 especie con 4 variantes de color** en el mismo campo que ya usábamos para "8 modelos de roca". No añade categoría de recurso ni ficha nueva, solo más arte para la misma entrada. Aplica igual a plantas (una amapola puede tener variante roja/blanca/rosa). Por defecto cada variante tiene el mismo peso (al azar uniforme); si se quiere que una variante sea más rara (ej. vaca blanca poco común) o esté ligada a estación/región (ej. más pelaje blanco en invierno o en Montaña Nevada), se declara un peso o una condición junto a esa variante — mismo mecanismo que ya usamos para ponderar variantes de roca por humedad (sección 11.5).

## 18. Formato de salida del bakeador

- **Un archivo índice por mapa**: nombre, semilla, tamaño en chunks, tipo/nombre de cada borde (sección 1), **número de versión del horneado**.
- **Un archivo por chunk**, nombrado por coordenadas (ej. `chunk_012_034`), con: rejilla de terreno, elevación, objetos colocados (referencia de catálogo + posición + variante + transformación), POIs que caen en ese chunk.
- La **versión del horneado** viaja en cada archivo — es lo que permite que, si más adelante se vuelve a hornear esa región con parámetros nuevos, el sistema sepa distinguir "terreno de fábrica nuevo" de "aquí un jugador ya dejó un cambio sobre la versión anterior" y no lo pise por accidente (ver sección 5, deltas).
- Es el mismo formato que lee tanto el visor de cámara libre del bakeador como el servidor del juego en producción — una sola definición, dos consumidores.

## 19. Principio de extensibilidad (regla permanente, no solo para el bakeador)

Para que añadir o cambiar cosas más adelante sea siempre rápido y sencillo, sin retrabajo:

- **Los campos del catálogo solo se añaden, nunca se renombran ni se reordena su significado** — una entrada horneada con una versión antigua del catálogo debe seguir funcionando cuando el catálogo crezca.
- **Una referencia a un `id` que el juego todavía no reconoce no rompe nada** — se muestra con una plantilla genérica (placeholder) hasta que esa entrada exista de verdad, tal como ya definimos para el sistema de referencias por nombre.
- **Ningún número mágico en el código**: cualquier valor ajustable (radios, tiempos, densidades, duración del calendario) vive en el catálogo de configuración, nunca escrito directamente en la lógica.
- **Todo dato horneado lleva su número de versión** (sección 18), así una regeneración futura nunca pisa el progreso de los jugadores sin darse cuenta.
- Estas cuatro reglas son las que hacen que la lista de "detalles de acabado" (secciones 3-11) haya podido crecer tanto sin tocar la arquitectura ni una sola vez — y son las que hay que seguir respetando en todo lo que se construya a partir de aquí, no solo en este bakeador.
