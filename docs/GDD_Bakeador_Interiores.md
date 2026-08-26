# GDD — Bakeador de Interiores

Diseño del generador de interiores (casas, tabernas, castillos, aldeas — **no** mazmorras/cuevas, eso es un bakeador aparte, ver sección 11). Mismo espíritu que `GDD_Bakeador_Exteriores.md`: reutilizar patrones ya probados (catálogo en dos niveles, reglas de sitio, variantes, densidad regional) en vez de inventar un sistema nuevo desde cero.

## 1. Arquitectura general

- **Cada interior es una instancia separada**, con su propio espacio de coordenadas — nada que ver con la rejilla de chunks del mapa exterior. Se entra por la puerta de un POI del exterior (mismo mecanismo `tipo: "portal"` que ya existe en `baker/catalogo/pois.json`), que solo coloca el disparador; la instancia real vive aparte.
- **Escala humana, no de mapa exterior**: un edificio no necesita tiles equivalentes a "20 minutos andando". Misma unidad de tile que exteriores (para que moverse por una puerta no cambie la sensación de escala del personaje), pero una sala es una rejilla pequeña — del orden de 5 a 15 tiles de lado según tipo de sala — en vez de un chunk de 32x32. El detalle fino (columnas, conductos, mobiliario) sale de tener muchos elementos pequeños colocables, no de subdividir el tile.
- **Un edificio de varias plantas es una pila de plantas WFC independientes** (sótano/bodega hacia abajo, pisos hacia arriba desde la entrada), conectadas verticalmente por huecos de escalera/trampilla — mismo concepto que una puerta entre dos salas de la misma planta, solo que en el eje Z.
- **Generación dirigida por config**, igual que `generarMapa(config)` en exteriores: el usuario (o el propio POI del exterior) pide `tipoEdificio` + plantas + preferencias de material/riqueza, y el motor resuelve el resto con WFC + catálogo. Misma semilla = mismo edificio siempre; otra semilla = layout distinto pero coherente con lo pedido.
- **Consola visual con campos, no descripción libre** — mismo motivo que la GUI de exteriores tiene checkboxes/campos numéricos en vez de un prompt: la coherencia sale de que las reglas del motor actúan sobre un config estructurado, no de interpretar bien un texto la primera vez. Una capa de texto→config (ej. "taberna 2 pisos 1 bodega en aldea" → el JSON de abajo) puede añadirse después como azúcar sobre lo mismo, nunca como sustituto.
- **Todos los campos son opcionales excepto `tipoEdificio`** — lo que no se especifica lo decide `tipos_edificio.json` (rango de plantas, mezcla de salas por planta, riqueza, materiales) tirando de la semilla, exactamente como en exteriores un bioma sin `reglasSitio` extra simplemente usa el pool por defecto. Ejemplo con (casi) todos los campos usados a la vez:

```json
{
  "tipoEdificio": "taberna",
  "semilla": "taberna-aldea-04",
  "contexto": { "bioma": "pradera", "poi": "aldea_agricola" },
  "riqueza": "modesta",
  "estadoConservacion": "habitado",
  "materialesPreferidos": ["madera", "piedra"],
  "densidadDecoracion": 0.7,
  "densidadSuciedad": 0.2,
  "plantas": [
    {
      "nivel": -1,
      "tipo": "bodega",
      "materialPreferido": "piedra",
      "tamano": { "anchoTiles": [7, 9], "largoTiles": [7, 10] },
      "salasForzadas": ["almacen"]
    },
    {
      "nivel": 0,
      "tipo": "planta_baja",
      "conectorArriba": "escalera_recta"
    },
    {
      "nivel": 1,
      "tipo": "planta_alta",
      "tamano": { "anchoTiles": [6, 8], "largoTiles": [8, 10] }
    }
  ]
}
```

Campos de la sección `plantas[]`: `nivel` (0 = planta baja, negativo = bajo tierra, positivo = superior — decide ventanas automáticamente, sección 7), `tipo` (rol de planta usado para elegir el pool de `salasPorPlanta` en `tipos_edificio.json`), `materialPreferido` (override puntual de esa planta, si no se hereda `materialesPreferidos`), `tamano` (override del rango de tiles de esa planta — si se omite, sale del tamaño típico de las salas que le tocan), `salasForzadas` (tipos de sala que sí o sí aparecen, aunque el sorteo ponderado no los saque), `conectorArriba` (qué tipo de `conectores.json` sube a la siguiente planta — si se omite, el motor elige uno válido según riqueza/rol). `densidadDecoracion` y `densidadSuciedad` son los mismos multiplicadores 0-1 que ya existen en exteriores para vegetación/fauna, aplicados aquí a mobiliario y a la capa de suciedad respectivamente — independientes entre sí, para poder pedir "una sala noble pero muy sucia" (abandonada hace tiempo) sin bajarle la riqueza.

- **`amueblado`** (opcional, por defecto `"completo"`) — qué capas de decoración coloca el bakeador de verdad, pensado para que un edificio propiedad de un jugador pueda generarse como cascarón y el jugador lo amueble él mismo desde el futuro menú de construcción (sección 7ter):
  - `"vacio"`: solo capa Estructural (suelo/pared/techo/puertas/ventanas/escaleras) — nada de `decorFija`, `decorMovible`, `iluminacion` ni `suciedad`.
  - `"fijo"`: Estructural + `decorFija` (chimenea, columnas, estanterías empotradas, tapices) — `decorMovible` se deja vacío a propósito, son justo los huecos que el jugador rellena.
  - `"completo"` (lo que se ha descrito hasta ahora en todo este documento): las 5 capas, igual que un edificio NPC que nadie va a redecorar.
  - Un edificio NPC (taberna, castillo, ayuntamiento...) casi siempre pide `"completo"`; una parcela de vivienda de jugador pide `"vacio"` o `"fijo"`.

## 2. Generación de la forma: Wave Function Collapse

- WFC resuelve la **planta** de cada piso sobre una rejilla de tiles, con módulos de pared-recta / esquina / puerta / suelo — el resultado es forma de sala(s), grosor de muro y dónde caen las puertas. Nada de mobiliario en este paso.
- **Sin muros en diagonal** — decisión explícita, no por gusto: WFC funciona bien con adyacencia en 4 direcciones: meter diagonales de verdad multiplica el catálogo de piezas (cada esquina/cruce necesita variante diagonal) por muy poco realismo ganado, y casas/castillos/aldeas reales casi nunca tienen muros a 45°. Formas en L, en T, rectangulares irregulares salen gratis del propio WFC con tiles normales, sin ningún truco.
- **Salas redondas como plantilla ya resuelta**, no tile a tile: una torre de castillo, por ejemplo, se coloca como un bloque especial con sus puntos de conexión ya definidos, en vez de intentar resolver un círculo con WFC — mismo concepto que "vignette" en el bakeador de exteriores.
- Tras resolver la forma, cada sala recibe un **tipo de sala** (ver sección 4) — igual que la clasificación de bioma en exteriores es un paso aparte de la colocación de vegetación.

## 2bis. Detección de sala: un conjunto de tiles + metadatos, no un rectángulo

`interiores/src/salas.js` implementa la **Sala** como abstracción independiente de cómo se decidió qué tiles pertenecen a ella — es la pieza que hacía falta para que WFC (cuando exista), selección manual y una herramienta rectangular (ambas del futuro menú de construcción, no del bakeador — sección 11) puedan compartir el mismo objeto sin que el resto del motor (`colocarElementos.js`, cálculo de estadísticas) tenga que saber cuál de las tres se usó:

- Una `Sala` es `{ tiles: Set, puertas: Set, ventanas: Set, minX/maxX/minY/maxY, ancho, largo }` — el conjunto de tiles de suelo conectados, no una forma geométrica fija.
- **Detección por flood-fill de área cerrada por paredes** (`detectarSalas`): sobre una rejilla de tiles (`suelo`/`pared`/`puerta`/`ventana`), cada región de 4-conectividad de tiles `suelo` es una sala; las puertas/ventanas que tocan su borde quedan anotadas como sus aberturas. Es la opción fiable pedida — no depende de adivinar nada, solo de qué tiles son de qué tipo — y es la que usa hoy `colocarElementos.js` sobre el rectángulo del prototipo: cuando WFC resuelva formas irregulares (en L, en T...), la misma función sigue sirviendo sin cambios, porque solo mira la rejilla resultante, nunca la forma de origen.
- **Circulación intacta** (`circulacionIntacta`): antes de dar por buena la colocación de un mueble, se vuelve a hacer flood-fill de los tiles de suelo libres (los de la sala menos los ya ocupados por huellas) desde la puerta — si no todos quedan alcanzables, esa colocación se descarta y se prueba otra. Es el chequeo real de "no puede bloquear la circulación principal" (sección 6 del pedido de integración): sin pathfinding ni heurísticas de ruta, solo alcanzabilidad.

## 3. Catálogo en dos niveles (mismo patrón que exteriores)

- **Materiales** (lista pequeña, ampliable) — el acabado de suelo/pared/techo: madera, piedra, ladrillo, estuco, papel pintado, tela/tapiz, metal, cristal. Equivalente a `categoriaRecurso` en exteriores.
- **Elementos** (lista grande, ampliable) — cada mueble/decoración/estructura fija es su propia entrada, como una `especie` en vegetación/animales. Campos por entrada: `capa`, `colocacion` (reglas de sitio, como `reglasSitio` en POIs), `huella` (footprint rectangular, como `radio` en POIs), `variantes`, `tiposSalaValidos`, `materialesCompatibles`. Opcionalmente `tileInteraccion` (offset relativo dentro de la huella en orientación 0° — sección 7quater) y `aportes` (contribución a las estadísticas de sala — sección 9bis).
- **`madera` y `piedra` no tienen un número de variantes propio — reutilizan el catálogo real de exteriores**: una mesa de madera puede salir de cualquiera de las ~26 especies de árbol ya definidas en `baker/catalogo/vegetacion.json` (pino, roble, abedul, sauce...), agrupadas por su `categoriaRecurso` (`madera_dura`/`madera_blanda`/`madera_sauce`/`madera_abedul`/`madera_palmera`/`madera_carbonizada`); un mueble de piedra igual contra `baker/catalogo/rocas.json` (`categoriaRecurso: piedra_comun` — granito, pizarra, caliza...). El cambio es sobre todo de tinte/textura del sprite, no una malla distinta — es la forma barata de multiplicar variación real (`interiores/catalogo/materiales.json` documenta el campo `especiesFuente` exacto). Una sola fuente de verdad: si se amplía el catálogo de árboles/rocas de exteriores, el mobiliario de interiores se vuelve más variado sin tocar nada aquí.

## 3ter. Coherencia de mobiliario: anclas y satélites, no piezas sueltas al azar

Colocar cada elemento de forma independiente (tirada propia por casilla, sin mirar qué hay ya colocado) da salas con muebles sueltos por ahí sin relación entre sí — una mesa en una esquina y las sillas en otra punta de la sala. En vez de eso, `interiores/src/colocarElementos.js` distingue dos roles:

- **Ancla**: cualquier elemento con `esSuperficie: true` (mesa_comedor, mesa_consejo, altar, mostrador...) — se coloca primero (antes que el resto de la capa), normalmente cerca del centro de la sala.
- **Satélite**: un elemento con `colocacion: ["juntoAMesa"]` (silla, banco, taburete) — se coloca en el anillo de casillas justo alrededor de una de las anclas ya puestas, nunca en un punto suelto de la sala. Si hay más de una mesa, se reparte entre las que menos satélites tengan. A diferencia del resto de piezas (una sola instancia por sala pequeña, para no repetir), un satélite sí puede repetirse varias veces (hasta 4) — es justo lo que da la imagen real de "mesa con sus sillas alrededor".
- **Simetría real** para salas con `simetrico: true` (`tipos_sala.json`): un elemento cuya única colocación es `simetrico` (ej. `columna`) se coloca por parejas en espejo respecto al eje central de la sala, no como instancia única descentrada.
- Los elementos `pegadaAPared` (chimenea, estanterías empotradas...) ya se colocaban pegados a un muro real, no sueltos — eso ya funcionaba antes de este apartado, aquí se explicita como parte del mismo principio: **nada se coloca sin una razón espacial**, cada `colocacion` de la tabla de la sección 7ter implica una regla de posición real, no solo una etiqueta descriptiva.

Verificado con un render real (`interiores/src/prueba_render_iso.js`): una `cocina_comedor` sale con la mesa en el centro y las sillas pegadas a su alrededor, no dispersas.

## 4. Capas

1. **Estructural** — suelo, pared, techo. Terreno = mecánica (transitable/bloquea), no decoración, mismo principio que en exteriores.
2. **Decoración fija** — no se mueve en juego: estanterías empotradas, chimenea, columnas, ventanas, puertas.
3. **Decoración movible** — mobiliario: cama, mesa, silla, arcón. "Movible" es una etiqueta para una futura mecánica (el jugador podría reposicionarlo); el bakeador la coloca igual que la fija, no cambia cómo se genera.
4. **Suciedad/desgaste** — capa puramente cosmética encima de las anteriores: telarañas, grietas, manchas, hojas caídas, polvo. No bloquea nada. Densidad modulada por el **estado de conservación del edificio** (nuevo/habitado/abandonado/ruina parcial) — mismo mecanismo que la densidad regional del bosque en exteriores, pero aquí ligada al tipo de POI (una `mazmorra_antigua` parte con más suciedad base que un `mercado_itinerante`). El estado de conservación también puede implicar **daño estructural real** (un boquete en la pared, techo hundido en una zona), no solo suciedad ambiental.
5. **Iluminación** (datos, no cálculo) — cada ventana/vela/antorcha es una fuente de luz de datos (posición) para que el motor en vivo calcule sombras — el bakeador nunca calcula el efecto en sí, igual que con clima/sombras en exteriores. Ver sección 7bis para el detalle de qué dato exacto deja cada ventana y cómo se separa de la luz de las fuentes interiores.

## 5. Tipos de sala (como los biomas)

Cada tipo de sala (dormitorio, cocina, sala_comun, almacén, biblioteca, taller, bodega, pasillo, gran_salón, sala_comercio...) declara su propia lista de elementos válidos y densidades — mismo mecanismo que biomas→especies. **Los pasillos son un tipo de sala propio**, no solo habitaciones con función: dan sensación de casa real en vez de habitaciones pegadas sin transición, con ancho variable y decoración mínima (alfombra corrida, cuadros).

- **`categoria` y `nombre` describen la función pretendida de la sala, nunca el mobiliario requerido**: `{ id, categoria, nombre }` (ej. `cocina` → `utilidad`/`"Cocina"`) es exactamente el schema mínimo pedido — añadir un tipo de sala nuevo es una entrada más en `tipos_sala.json`, no un cambio de motor. `tipos_sala.json` no lista `categoria` como una taxonomía cerrada de antemano: hoy cubre `residencial`, `almacenamiento`, `artesania`, `religioso`, `civico`, `comercio`, `circulacion`, `ocio`, `utilidad`, y se amplía igual que el resto del catálogo si hace falta una nueva. Una `dormitorio` sin ningún elemento colocado (`amueblado: "vacio"`) **sigue siendo un dormitorio** — el tipo de sala nunca depende de qué haya dentro (ver sección 8bis).

- **Familias de sala por tamaño/configuración, no un único tipo genérico con un rango de tiles amplio**: `dormitorio` (genérico, se mantiene) convive con `dormitorio_individual` / `dormitorio_doble` / `dormitorio_comunal` / `dormitorio_con_bano` / `dormitorio_enorme`, y lo mismo con `comedor_pequeno` / `comedor_mediano` / `comedor_grande` / `cocina_comedor` (cocina y comedor en planta abierta, sin dividir en dos salas). No es solo cuestión de tamaño — cada variante implica mobiliario distinto (una `dormitorio_comunal` lleva literas, una `dormitorio_doble` una cama de matrimonio) y a veces riqueza mínima distinta (`dormitorio_con_bano`/`dormitorio_enorme` son noble). Esto le da a cada `tipoEdificio` control fino real: una taberna pide una mezcla de `dormitorio_individual`+`dormitorio_comunal` en sus habitaciones de huéspedes, un castillo mezcla `dormitorio_enorme` (alcoba del señor) + `dormitorio_doble` (nobles) + `dormitorio_comunal` (guarnición/servidumbre) en la misma planta — algo que un único tipo `dormitorio` con rango de tamaño no puede expresar. Mismo patrón aplicable a cualquier otra sala que lo necesite (`sala_comun`, `almacen`...) cuando haga falta, no es exclusivo de estas dos familias.

## 6. Tipos de edificio

Cada `tipoEdificio` (casa_humilde, casa_noble, taberna, tienda, castillo, choza_pescador...) declara: rango de plantas típico, qué tipos de sala le tocan por planta y con qué peso, riqueza típica, materiales por defecto. Se puede enganchar directamente a un POI del exterior (`tienda_cazador` → tipoEdificio pequeño y modesto; `castillo_en_ruinas` → tipoEdificio noble con daño estructural) sin inventar un sistema nuevo — o pedirse a mano vía config, igual que hoy se puede lanzar el bakeador de exteriores sin pasar por la GUI.
- **Cobertura amplia, estilo Skyrim/Stardew Valley/WoW**: vivienda (varios niveles de riqueza), oficios (herrería, molino, panadería, sastre...), negocios/hostelería (tienda, taberna, posada), gobierno/comunidad (ayuntamiento, casa de gremio, cuartel), servicios públicos y cultura (biblioteca pública, museo, baños públicos, templo) — ver `interiores/README.md` para el listado completo. El catálogo de tipos de edificio crece igual que el de elementos: se sigue añadiendo según haga falta, no hay un tope pensado.
- **`poiVinculado` es opcional, no obligatorio** — muchos `tipoEdificio` de pueblo/ciudad (herrería, ayuntamiento, casa de gremio, biblioteca pública...) no tienen ni necesitan un POI 1:1 en el exterior total. Un asentamiento (`aldea_agricola`, `ciudad_poblada_menor`) es en realidad su propia instancia navegable con varios edificios a la vez, cada uno con su propia puerta — un tercer tipo de mapa, intermedio entre el exterior total y los interiores. Diseño capturado por separado en `GDD_Bakeador_POIs.md` (esqueleto, sin motor todavía) para no mezclar dos escalas distintas en este documento.

## 7. Conectores verticales y aberturas

- **Escaleras**: recta, caracol, vertical/escala de mano — cada una con huella y si permite pasar mobiliario grande (una caracol no deja subir un armario).
- **Trampillas**: arriba y abajo, mismo hueco conceptual que una puerta pero en el plano techo/suelo.
- **Puertas**: individual y doble. La puerta principal (la que conecta con el POI del exterior) es visual/estructuralmente distinta de las interiores — marco más trabajado, tamaño mayor (`esPuertaPrincipal`).
- **Conducto de chimenea**: si se coloca un hogar en la planta N, esa misma casilla (x,y) se reserva como conducto — no transitable, sin mobiliario — en todas las plantas por encima, hasta la última planta del edificio. Mismo tipo de restricción vertical que una escalera (posición fija repetida entre plantas consecutivas), pero el conducto no da paso, solo ocupa espacio. El exterior no cambia nada por esto — sigue sin dibujar tejados ni chimeneas, es 100% interno al bakeador de interiores.
- **Ventanas**: solo dejan pasar luz — nunca renderizan vista al exterior (el interior es instancia separada, no tiene sentido "ver" el mapa exterior desde dentro). Solo pueden aparecer en plantas con fachada al exterior — sótanos/bodegas nunca llevan ventana (regla de sitio por nivel de planta, igual que `bandaElevacionMin` en exteriores).
- **Ventanas y puertas como combinación de atributos, no variantes fijas**: para cubrir tamaño × altura × marco × forma × cristal sin tener que pintar cientos de combinaciones a mano, cada ventana compone varios ejes independientes (`forma`: rectangular/redonda/arco: `tamano`: pequeña/media/grande; `marco`: con/sin; `cristal`: liso/vidriera) en vez de un único campo `variantes` como en exteriores. El arte se compone por capas superpuestas (marco + hueco + cristal).
- **Balcón/galería interior de doble altura** — un piso superior con hueco que mira a la sala de abajo, típico de gran salón de castillo. Siempre interior, nunca un balcón que mire al mapa exterior.

## 7bis. Iluminación: dato de "aporte de luz" vs. cálculo en vivo por hora

Misma separación dato/cálculo que el resto del proyecto (clima y sombras en exteriores, cono de visión en `Backlog_Mecanicas_Futuras.md`) — el bakeador nunca calcula cuánta luz hay en una sala en un momento dado, solo dos tipos de dato que el motor en vivo necesita para hacerlo:

- **Luz ambiente (exterior colándose por ventana)**: cada instancia de ventana ya colocada lleva un campo `aporteLuz` numérico, resuelto por el bakeador a partir de sus atributos combinatorios (`tamano.anchoTiles` × factor por `altaEnPared` × factor por `cristal` — normalmente 1, pero `cristal.esmerilado` y `tamano.tronera` declaran su propio `aporteLuz` explícito en `ventanas.json` porque su geometría no sigue la fórmula simple). Una sala sin ninguna ventana no lleva este dato — luz ambiente siempre 0 para ella, nunca se calcula "a través de la pared" ni de una sala vecina. **Sin orientación** — coherente con la sección 10 (nada de orientación solar): da igual a qué lado del edificio mire la ventana, solo cuenta su tamaño/tipo. El motor en vivo suma el `aporteLuz` de las ventanas de la sala y lo multiplica por una curva día/noche global (día: variable según hora; noche: 0 o un valor bajo fijo si hay luna) — esa curva y el resultado final NO son responsabilidad del bakeador, se explica en el backlog.
- **Luces interiores** (vela, antorcha, candelabro, lámpara — capa `iluminacion` de `elementos.json`): cada una es una fuente de luz de datos con posición fija, independiente de la hora exterior — normalmente se consideran encendidas de forma constante (nada de simular quién las enciende/apaga, eso sería una mecánica de juego aparte, no bakeador).

## 7ter. Reglas de colocación por plano — pared/suelo/techo, para que el futuro menú de construcción sea intuitivo

Hasta ahora `colocacion` en `elementos.json` era una etiqueta suelta ("pegadaAPared", "colgadoEnPared"...). Aquí se formaliza qué implica cada valor en términos de plano, colisión y requisito — la misma tabla que tendrá que consultar el motor de generación (para no colocar nada ilegal) y, más adelante, el menú de construcción en vivo (para saber qué puede hacer el jugador y dónde). Es la razón de ser de esta sección: preparar el dato ahora para que esa mecánica futura no tenga que inventarse sus propias reglas de cero, y quede coherente con lo que generó el bakeador.

| `colocacion` | Plano | ¿Bloquea movimiento? | ¿Bloquea visión? | Requisito para colocarse |
|---|---|---|---|---|
| `colgadoEnPared` | Pared | No | No | Un segmento de pared **en blanco** en esa posición — nunca sobre un hueco de puerta/ventana. Es el único valor "de pared": ningún elemento sin este tag puede ir sobre el plano pared. |
| `pegadaAPared` | Suelo, tocando una pared | Sí, según su `huella` (igual que cualquier decorMovible/decorFija con footprint) | No | Casilla de suelo libre adyacente a un segmento de pared (puede ser una pared con ventana encima, no hace falta que esté en blanco — solo el propio hueco de la puerta queda excluido). |
| `centroSala` / `libre` / `esquina` | Suelo | Sí, según `huella` | No | Igual que `pegadaAPared` pero sin requisito de estar junto a una pared — cada tag matiza la posición preferida dentro de la sala, no cambia la colisión. |
| `juntoAMesa` | Suelo, pegado a un ancla | Sí, según `huella` | No | Requiere una casilla libre del anillo justo alrededor de la huella de un elemento con `esSuperficie: true` ya colocado en la sala (mesa, mostrador, altar...) — nunca un punto suelto de la sala. Si hay varias anclas, se reparte entre las que menos satélites tengan todavía. Es lo que hace que "sillas alrededor de la mesa" salga de verdad como un conjunto, no piezas sueltas puestas al azar (ver sección 3ter). |
| `simetrico` (como único valor de `colocacion`, sin combinar con otro) | Suelo | Sí, según `huella` | No | En una sala con `simetrico: true` (`tipos_sala.json`), se coloca por parejas en espejo respecto al eje central de la sala (columnas a ambos lados, etc.) — nunca una sola instancia suelta descentrada. Combinado con `centroSala` (ej. `trono`) el elemento es único por definición — ahí `simetrico` solo significa "respeta el eje", no "duplícate". |
| `sobreSuperficie` | Suelo, pero encima de otro elemento | No (ya la bloquea el elemento anfitrión) | No | Requiere un elemento con `esSuperficie: true` ya colocado en esa misma casilla (mesa, mostrador, atril, altar — sección 3bis de `elementos.json`). Sin anfitrión no es una posición válida. |
| `techo` | Techo | No | No | Ninguno especial — cualquier casilla de la sala (viga vista, bóveda, artesonado, araña de luces). |
| `suelo` (capa suciedad) | Suelo, decal | No | No | Ninguno — es puramente cosmético, se puede pisar/superponer con cualquier otra cosa. |

Reglas estructurales que se derivan de la misma tabla, ya establecidas en otras secciones pero explicitadas aquí como regla formal:

- **Las paredes bloquean movimiento y visión** — no se puede atravesar ni ver a través de una pared. Coherente con la maqueta 2.5D validada al principio de esta conversación (oclusión exacta a la silueta del hueco de la puerta, sección 11/`Backlog_Mecanicas_Futuras.md`).
- **Puertas y ventanas son huecos en la pared, no la pared misma** — una puerta abierta no bloquea movimiento; ni puerta ni ventana bloquean visión en su propia silueta (la puerta porque literalmente no hay pared ahí; la ventana porque dejar pasar la vista sería lo mismo que "ver el exterior", explícitamente descartado en la sección 10 — así que una ventana bloquea visión igual que una pared, solo deja pasar el dato de luz de la sección 7bis). Ninguna de las dos admite un elemento `colgadoEnPared` en su misma posición.
- **Solo `decorMovible` desaparece bajo `amueblado: "vacio"`/`"fijo"`** (sección 1) — las reglas de esta tabla no cambian con el nivel de amueblado, solo cambia qué subconjunto de elementos coloca el bakeador de antemano. Los huecos que quedan vacíos son exactamente las posiciones legales (según esta misma tabla) que el jugador podrá rellenar desde el menú de construcción — mismo patrón dato-ahora/mecánica-después que iluminación (7bis) y el cono de visión.

## 7quater. Orientación (rotación) y tile de interacción

- **La huella no es una caja homogénea** — un mueble con footprint 1×2 (una cama, un banco de trabajo) tiene un lado que da a la pared y otro por el que se usa; tratarlo como un bloque uniforme pierde esa distinción. Cada elemento puede declarar `tileInteraccion` como un offset `[dx, dy]` relativo a la esquina de origen de su huella en orientación 0° — ej. una cama 1×2 (`cama_individual`) declara `[0, 1]`: se usa desde el tile de los pies, no desde el que toca la pared.
- **0°/90°/180°/270°** (`interiores/src/rotacion.js`, `ORIENTACIONES`): `rotarHuella` intercambia ancho/largo a 90°/270°; `rotarOffset` rota el `tileInteraccion` sobre la misma esquina de referencia que la huella, así que huella y punto de interacción siempre giran juntos, nunca uno sin el otro. `colocarElementos.js` prueba una orientación por intento de colocación en suelo (no una fija por elemento) y guarda la orientación elegida (`rotacion`) y el `tileInteraccion` ya resuelto a coordenadas absolutas de sala en el resultado.
- Los elementos sin `tileInteraccion` (la mayoría de decoración) simplemente no llevan ese campo en el resultado — no es obligatorio, solo se resuelve para piezas realmente interactivas (camas, mesas de trabajo, horno, yunque...).

## 8. Suelos

- **Material por nivel de planta**: tendencia piedra en sótanos/plantas bajas, madera en plantas altas — mismo patrón que el desnivel en exteriores varía el terreno, aquí la "banda" es el número de planta en vez de la elevación continua.
- **Mosaicos/patrones de suelo** como capa aparte del material base — un patrón que se estampa encima (suelo ajedrezado en un salón noble, por ejemplo), no mezclado con el material en sí.
- **Pared y suelo como paletas de material independientes por sala** — una cocina puede tener suelo de piedra y pared de estuco; un dormitorio, suelo de madera y pared con papel.

## 9. Otros elementos de detalle confirmados

- **Chimeneas/hogares**, con el conducto vertical de la sección 7.
- **Techo con estilo estructural**, no solo material: viga vista, bóveda de piedra, artesonado — coherente con lo noble/humilde del edificio.
- **Columnas** en salas grandes (salón del trono, gran comedor).
- **Tapices/cuadros de pared** como decoración fija de pared, no solo de suelo.
- **Riqueza/nivel socioeconómico del edificio** como parámetro que filtra qué materiales/mobiliario están disponibles.
- **Simetría en salas nobles vs. asimetría orgánica en salas comunes** — regla de estilo de colocación por tipo de sala.
- **Estado del propio mueble** (intacto/roto/volcado), no solo suciedad ambiental.
- **Camas de varios tamaños** (individual/doble/litera) según riqueza y tipo de sala.
- **Muebles marcados como contenedor sí/no** — dato reservado para la futura mecánica de inventario, mismo patrón "reservado, no implementado todavía" que `tierra_labrada` en exteriores.

## 9bis. Funcionalidad y estadísticas de sala (aportes aditivos)

- **Cada elemento puede declarar `aportes: { estadistica: valor }`** en `elementos.json` — ej. `cama_individual` aporta `{ funcionalidad: 40, confort: 15 }`, `armario` aporta `{ almacenamiento: 30 }`. `interiores/src/estadisticas.js` (`calcularEstadisticas`) suma los aportes de todo lo realmente colocado en la sala (suelo, pared, techo o encima de una superficie) y el resultado se adjunta a la salida de `colocarSala` como `estadisticas`.
- **Totalmente dirigido por datos**: añadir una estadística nueva, o cambiar cuánto aporta una pieza, es editar `elementos.json` — no tocar `estadisticas.js` ni `colocarElementos.js`. Hoy el catálogo usa `funcionalidad`, `confort`, `almacenamiento` y `decoracion` en unas 39 piezas representativas (camas, mesas/mostradores/altar/trono, contenedores, mobiliario de oficio, chimenea, decoración de pared, asientos) — el resto de elementos simplemente no lleva `aportes` y no participa en la suma.
- **Ejemplo real**: un dormitorio vacío da `estadisticas: {}`; con una `cama_individual` pasa a `{ funcionalidad: 40, confort: 15 }`; si además lleva `armario`, suma `almacenamiento: 30`. La suma es puramente aditiva, sin techos ni combinaciones especiales entre piezas.
- **Nunca decide si la sala es válida** — coherente con la sección 5: una sala sin ningún elemento con `aportes` (o sin ningún elemento en absoluto, `amueblado: "vacio"`) sigue siendo un tipo de sala legítimo, solo que con `estadisticas: {}`. El futuro uso en vivo de estas estadísticas (umbrales de confort para NPCs, requisitos de funcionalidad para tareas...) es mecánica de servidor, no de este bakeador.

## 9ter. Edificios multi-planta y editor manual (generar + editar, no solo generar)

Un interior deja de ser una única habitación aislada: `interiores/src/edificio.js` compone varias `colocarSala` en `Edificio → Planta → Sala`, y `interiores/src/edicion.js` + `interiores/gui/` dejan tocar cualquier cosa después sin que una regeneración la destruya. Ninguna de las dos piezas reescribe `colocarSala`/`salas.js` — los llaman y componen el resultado.

**Composición de planta** (`edificio.js`, `generarPlanta`): `tipos_edificio.json` ya traía `salasPorPlanta` como listas ponderadas por planta (`[[tipoSala, peso], ...]`) — perfecto para sorteo con variación real (misma semilla = mismo edificio, otra semilla = otra mezcla de salas/tamaños, sección 12 del pedido de edificios). El número de salas por planta sale de un rango según riqueza (2-5), no un valor fijo. Layout con una sola estrategia fiable, no una colección de heurísticas:
- **Con pasillo** (`tipos_sala.pasillo`, `esPasillo:true`): las demás salas de la planta se ponen en fila justo encima, alineadas por el muro sur; el pasillo se genera con el ancho exacto de esa fila (`anchoForzado`, parámetro nuevo y opcional de `colocarSala`) de modo que la puerta sur que cada sala YA trae de fábrica cae literalmente sobre el muro norte del pasillo — se reutiliza la puerta real, no se inventa una segunda.
- **Sin pasillo**: las salas se ponen en fila compartiendo una columna (solapada 1 tile a propósito) y ahí se abre una puerta nueva — el único caso donde de verdad hace falta inventar una puerta que `colocarSala` no trajera ya.
- Cada sala pintada sobre la rejilla de planta se re-detecta con la misma `detectarSalas` de la sección 2bis: los huecos de puerta compartidos aparecen automáticamente en el conjunto `puertas` de las DOS salas vecinas — esa coincidencia **es** la conexión, no hace falta un grafo de adyacencia aparte.
- **Habitación no rectangular** (`generarHabitacionCompuestaL`, sección 3 del pedido): dos salas rectangulares reales unidas por una abertura ANCHA (varias celdas de puerta seguidas en el muro compartido, no solo una) — se lee como un espacio en forma de L sin tocar el motor de colocación de una sala (que sigue siendo rectangular, sección 2).
- **Plantas sin continuidad XY real** — mismo modelo que ya declaraba la sección 7 ("pila de plantas independientes conectadas por huecos de escalera"): cada edificio guarda solo en qué sala/planta cae cada conector vertical (`conectoresVerticales`, de `conectores.json`), no una coordenada 3D continua.

**Edición no destructiva** (`edicion.js`, sección 4/5 del pedido): cada pieza que coloca el generador lleva `instanceId` único y `origen: "generado"` (colocarElementos.js las marca al final de `colocarSala`). Operaciones sobre una pieza por su `instanceId`: `moverElemento`, `rotarElemento`, `eliminarElemento`, `anadirElemento`, `duplicarElemento`, `sustituirElemento` — todas ponen `origen: "modificado"` en lo que tocan. `cambiarTipoSala` hace lo mismo a nivel de sala. **Solo salirse de los límites de la sala bloquea de verdad** (`fuera_de_limites`, dato inválido); solapamiento y bloqueo de puerta son avisos (`solapa_con_otro_mueble`, `bloquea_la_puerta`) que se pueden confirmar con `forzar:true` — el diseñador tiene libertad para distribuciones poco convencionales, coherente con "no ser demasiado restrictivo" del pedido. La suciedad (capa `suciedad`) nunca avisa de solape, coherente con la sección 7ter ("se puede pisar/superponer con cualquier otra cosa").

**Regeneración parcial que respeta lo editado** (`regenerarMobiliario`/`regenerarHabitacion`/`regenerarPiso`/`regenerarEdificio`, sección 6 del pedido): regenerar vuelve a llamar a `colocarSala` desde cero, pero antes aparta todas las piezas ya marcadas `modificado`, y después descarta cualquier pieza recién generada que caería encima de una de ellas — así una regeneración nunca borra una edición manual sin pedirlo explícitamente (`forzar:true`). Si la SALA en sí fue editada a mano (tipo cambiado con `cambiarTipoSala`), `regenerarHabitacion` se niega a tocarla salvo `forzar:true` — regenerar el edificio entero nunca destruye a ciegas una habitación que el usuario ya afinó. Verificado con un edificio real: cambiar `biblioteca`→`almacen` a mano y luego regenerar la planta Y el edificio completo deja la sala como `Almacén (modificado)` intacta.

**Editor web** (`interiores/gui/`, mismo patrón que `baker/gui/`: servidor http plano sin framework + página estática, sección 4/8/10 del pedido): árbol Edificio→Planta→Sala en el panel izquierdo (niveles de edición de la sección 10), vista isométrica 2.5D interactiva en el centro (misma proyección de `prueba_render_iso.js`, ahora con cada mueble como objetivo de clic real), panel derecho con info de la sala (tipo/categoría/piso/tamaño/riqueza/nº muebles/estadísticas, sección 8) y del mueble seleccionado (mover con flechas, rotar con R/botón, eliminar, duplicar, sustituir por otro id del catálogo) más una paleta para añadir cualquier pieza del catálogo haciendo clic en una casilla libre. Botones de generación parcial (mobiliario de la sala / planta / edificio, sección 6) con una casilla `forzar` explícita — la generación nunca es un resultado final bloqueado (sección 4). "Guardar" escribe el edificio actual (generado + modificado mezclado) a `interiores/output/<id>.json`.

## 10. Explícitamente descartado (para no reabrirlo sin motivo)

- **Muros en diagonal de verdad** — ver sección 2.
- **Orientación solar del edificio respecto al mapa** — nivel de simulación que no se nota jugando y complica la generación sin beneficio real.
- **Ventanas que renderizan vista al exterior** — el interior es instancia separada, no tiene sentido.
- **Balcones que dan al mapa exterior** — mismo motivo.

## 11. Fuera del alcance de este bakeador

- **Mazmorras/cuevas/dungeons** — geometría mucho más orgánica (BSP/autómata celular en vez de WFC con reglas de arquitectura civil), es un bakeador aparte. No reutilizar este diseño para eso sin pensarlo de nuevo.
- **Cálculo de sombras/iluminación en vivo, incluida la curva de luz ambiente por hora del día** — el bakeador solo deja los datos (posición de fuentes de luz, `aporteLuz` de cada ventana — sección 7bis); el cálculo del resultado final (cuánta luz hay en la sala a las 14:00 vs. a medianoche) es del servidor en vivo.
- **Cono de visión del jugador entre salas** — apuntado en `Backlog_Mecanicas_Futuras.md`, es cálculo en vivo del cliente/servidor según posición y orientación del jugador, no responsabilidad del bakeador.
- **El menú de construcción en sí** (arrastrar/soltar mobiliario, validar una colocación, guardarla) — apuntado en `Backlog_Mecanicas_Futuras.md`. El bakeador (sección 7ter) deja la tabla de reglas de colocación y el nivel `amueblado` que decide qué huecos quedan libres; construir la interfaz y la lógica de validación en vivo es mecánica de cliente/servidor, no del bakeador.

## 12. Estado actual

Diseño cerrado en esta fase de conversación. Catálogo (`interiores/catalogo/*.json`) ampliado a un tamaño comparable al de exteriores en su primera pasada — ver `interiores/README.md` para el recuento exacto y el detalle de qué hay ya escrito. `interiores/config/*.json` documenta con ejemplos el schema de config que consumirá el motor (sección 1), aunque el motor todavía no existe para leerlo de verdad.

Primera pieza real del motor construida y probada (`interiores/src/`): dada una sala con forma rectangular fija (todavía no WFC), `colocarElementos.js` coloca estructura + elementos respetando riqueza, `amueblado` y las reglas de colocación de la sección 7ter, con coherencia de mobiliario real (anclas/satélites, sección 3ter) en vez de piezas sueltas al azar. Probado con `prueba_render_iso.js`, que dibuja el resultado en la misma proyección isométrica 2.5D validada al principio de esta conversación (no en planta 2D).

Sistema de salas/mobiliario ampliado y ya integrado en el mismo motor (`colocarSala`), no solo diseñado en el papel:

- **Detección de sala** (sección 2bis, `salas.js`): el rectángulo del prototipo se convierte en una rejilla real de tiles (`suelo`/`pared`/`puerta`) y `detectarSalas` produce el objeto `Sala` (`sala` en el resultado) por flood-fill — método-agnóstico por diseño, listo para cuando la forma deje de ser un rectángulo.
- **Circulación intacta** (`circulacionIntacta`): cada intento de colocación en suelo (`intentarColocarEnSuelo`, `intentarJuntoAMesa`, `colocarSimetrico`) se deshace si bloquearía el paso desde la puerta — comprobado con flood-fill real, no heurística.
- **Orientación** (sección 7quater, `rotacion.js`): las piezas de suelo prueban las 4 orientaciones; huella y `tileInteraccion` rotan juntas y quedan en el resultado (`rotacion`, `tileInteraccion` en coordenadas absolutas).
- **`categoria`/`nombre`** añadido a los 39 tipos de `tipos_sala.json` (sección 5) y **`aportes`/`tileInteraccion`** añadido a ~39/17 elementos representativos de `elementos.json` (camas, superficies de trabajo, contenedores, piezas de oficio, chimenea, decoración de pared, asientos).
- **Estadísticas de sala** (sección 9bis, `estadisticas.js`): suma aditiva de `aportes` de lo colocado, adjunta como `estadisticas` en el resultado — verificado con salas reales (`comedor_grande` noble → `{funcionalidad:30, confort:37, decoracion:25}`, `taller` humilde → `{funcionalidad:200, confort:5}`, etc.).

Todo verificado con `node -e` sobre `colocarSala` (sin mismatches de `sala.tiles`, sin referencias huérfanas en el catálogo tras las nuevas entradas) y con un render isométrico real (`prueba_render_iso.js` + captura Playwright) que sigue mostrando la coherencia mesa+sillas sin regresión visual tras integrar rotación/circulación.

**Edificios multi-planta + editor manual** (sección 9ter) — segunda pieza real del motor, ya construida y probada de punta a punta, no solo diseñada:

- `edificio.js` compone `Edificio → Planta → Sala` a partir de `tipos_edificio.json` con puertas de conexión reales entre salas contiguas (fila-sobre-pasillo o solape de columna) y habitaciones en L (`generarHabitacionCompuestaL`). Probado con 132 combinaciones (las 44 `tipoEdificio` × 3 semillas cada una) sin errores y sin ninguna sala sin detectar en su planta.
- `edicion.js` da mover/rotar/eliminar/añadir/duplicar/sustituir sobre cualquier pieza ya colocada, y `regenerarMobiliario`/`Habitacion`/`Piso`/`Edificio` regeneran respetando lo ya marcado `origen: "modificado"` — verificado que una sala editada a mano sobrevive intacta a una regeneración del edificio COMPLETO.
- `interiores/gui/servidor.js` + `index.html`: editor web real (no una maqueta) con árbol de navegación, vista isométrica interactiva, edición de mobiliario y regeneración parcial. Probado de extremo a extremo con Playwright: generar edificio → seleccionar sala → añadir mueble desde la paleta → seleccionar/rotar/eliminar → cambiar tipo de sala → regenerar mobiliario/planta/edificio (confirmando que la sala editada a mano no se pierde) → guardar a disco.

**Lo que falta de verdad**: resolver la forma de una sala individual con Wave Function Collapse (sigue siendo un rectángulo — la detección de sala de la sección 2bis y la composición de planta de la 9ter ya están listas para ese cambio sin tocarse), conducto de chimenea vertical entre plantas, y que el editor lea/escriba los config de `config/*.json` en vez de solo el estado en memoria del servidor.
