# GDD — Bakeador de Interiores

Diseño del generador de interiores (casas, tabernas, castillos, aldeas — **no** mazmorras/cuevas, eso es un bakeador aparte, ver sección 11). Mismo espíritu que `GDD_Bakeador_Exteriores.md`: reutilizar patrones ya probados (catálogo en dos niveles, reglas de sitio, variantes, densidad regional) en vez de inventar un sistema nuevo desde cero.

## 1. Arquitectura general

- **Cada interior es una instancia separada**, con su propio espacio de coordenadas — nada que ver con la rejilla de chunks del mapa exterior. Se entra por la puerta de un POI del exterior (mismo mecanismo `tipo: "portal"` que ya existe en `baker/catalogo/pois.json`), que solo coloca el disparador; la instancia real vive aparte.
- **Escala humana, no de mapa exterior**: un edificio no necesita tiles equivalentes a "20 minutos andando". Misma unidad de tile que exteriores (para que moverse por una puerta no cambie la sensación de escala del personaje), pero una sala es una rejilla pequeña — del orden de 5 a 15 tiles de lado según tipo de sala — en vez de un chunk de 32x32. El detalle fino (columnas, conductos, mobiliario) sale de tener muchos elementos pequeños colocables, no de subdividir el tile.
- **Un edificio de varias plantas es una pila de plantas WFC independientes** (sótano/bodega hacia abajo, pisos hacia arriba desde la entrada), conectadas verticalmente por huecos de escalera/trampilla — mismo concepto que una puerta entre dos salas de la misma planta, solo que en el eje Z.
- **Generación dirigida por config**, igual que `generarMapa(config)` en exteriores: el usuario (o el propio POI del exterior) pide `tipoEdificio` + plantas + preferencias de material/riqueza, y el motor resuelve el resto con WFC + catálogo. Misma semilla = mismo edificio siempre; otra semilla = layout distinto pero coherente con lo pedido. Ejemplo de config:

```json
{
  "tipoEdificio": "taberna",
  "semilla": "taberna-aldea-04",
  "contexto": { "bioma": "pradera", "poi": "aldea_agricola" },
  "plantas": [
    { "nivel": -1, "tipo": "bodega", "materialPreferido": "piedra" },
    { "nivel": 0,  "tipo": "planta_baja" },
    { "nivel": 1,  "tipo": "planta_alta" }
  ],
  "materialesPreferidos": ["madera", "piedra"],
  "riqueza": "modesta"
}
```

## 2. Generación de la forma: Wave Function Collapse

- WFC resuelve la **planta** de cada piso sobre una rejilla de tiles, con módulos de pared-recta / esquina / puerta / suelo — el resultado es forma de sala(s), grosor de muro y dónde caen las puertas. Nada de mobiliario en este paso.
- **Sin muros en diagonal** — decisión explícita, no por gusto: WFC funciona bien con adyacencia en 4 direcciones: meter diagonales de verdad multiplica el catálogo de piezas (cada esquina/cruce necesita variante diagonal) por muy poco realismo ganado, y casas/castillos/aldeas reales casi nunca tienen muros a 45°. Formas en L, en T, rectangulares irregulares salen gratis del propio WFC con tiles normales, sin ningún truco.
- **Salas redondas como plantilla ya resuelta**, no tile a tile: una torre de castillo, por ejemplo, se coloca como un bloque especial con sus puntos de conexión ya definidos, en vez de intentar resolver un círculo con WFC — mismo concepto que "vignette" en el bakeador de exteriores.
- Tras resolver la forma, cada sala recibe un **tipo de sala** (ver sección 4) — igual que la clasificación de bioma en exteriores es un paso aparte de la colocación de vegetación.

## 3. Catálogo en dos niveles (mismo patrón que exteriores)

- **Materiales** (lista pequeña, ampliable) — el acabado de suelo/pared/techo: madera, piedra, ladrillo, estuco, papel pintado, tela/tapiz, metal, cristal. Equivalente a `categoriaRecurso` en exteriores.
- **Elementos** (lista grande, ampliable) — cada mueble/decoración/estructura fija es su propia entrada, como una `especie` en vegetación/animales. Campos por entrada: `capa`, `colocacion` (reglas de sitio, como `reglasSitio` en POIs), `huella` (footprint rectangular, como `radio` en POIs), `variantes`, `tiposSalaValidos`, `materialesCompatibles`.

## 4. Capas

1. **Estructural** — suelo, pared, techo. Terreno = mecánica (transitable/bloquea), no decoración, mismo principio que en exteriores.
2. **Decoración fija** — no se mueve en juego: estanterías empotradas, chimenea, columnas, ventanas, puertas.
3. **Decoración movible** — mobiliario: cama, mesa, silla, arcón. "Movible" es una etiqueta para una futura mecánica (el jugador podría reposicionarlo); el bakeador la coloca igual que la fija, no cambia cómo se genera.
4. **Suciedad/desgaste** — capa puramente cosmética encima de las anteriores: telarañas, grietas, manchas, hojas caídas, polvo. No bloquea nada. Densidad modulada por el **estado de conservación del edificio** (nuevo/habitado/abandonado/ruina parcial) — mismo mecanismo que la densidad regional del bosque en exteriores, pero aquí ligada al tipo de POI (una `mazmorra_antigua` parte con más suciedad base que un `mercado_itinerante`). El estado de conservación también puede implicar **daño estructural real** (un boquete en la pared, techo hundido en una zona), no solo suciedad ambiental.
5. **Iluminación** (datos, no cálculo) — cada ventana/vela/antorcha es una fuente de luz de datos (posición) para que el motor en vivo calcule sombras — el bakeador nunca calcula el efecto en sí, igual que con clima/sombras en exteriores.

## 5. Tipos de sala (como los biomas)

Cada tipo de sala (dormitorio, cocina, sala_comun, almacén, biblioteca, taller, bodega, pasillo, gran_salón, sala_comercio...) declara su propia lista de elementos válidos y densidades — mismo mecanismo que biomas→especies. **Los pasillos son un tipo de sala propio**, no solo habitaciones con función: dan sensación de casa real en vez de habitaciones pegadas sin transición, con ancho variable y decoración mínima (alfombra corrida, cuadros).

## 6. Tipos de edificio

Cada `tipoEdificio` (casa_humilde, casa_noble, taberna, tienda, castillo, choza_pescador...) declara: rango de plantas típico, qué tipos de sala le tocan por planta y con qué peso, riqueza típica, materiales por defecto. Se puede enganchar directamente a un POI del exterior (`tienda_cazador` → tipoEdificio pequeño y modesto; `castillo_en_ruinas` → tipoEdificio noble con daño estructural) sin inventar un sistema nuevo — o pedirse a mano vía config, igual que hoy se puede lanzar el bakeador de exteriores sin pasar por la GUI.

## 7. Conectores verticales y aberturas

- **Escaleras**: recta, caracol, vertical/escala de mano — cada una con huella y si permite pasar mobiliario grande (una caracol no deja subir un armario).
- **Trampillas**: arriba y abajo, mismo hueco conceptual que una puerta pero en el plano techo/suelo.
- **Puertas**: individual y doble. La puerta principal (la que conecta con el POI del exterior) es visual/estructuralmente distinta de las interiores — marco más trabajado, tamaño mayor (`esPuertaPrincipal`).
- **Conducto de chimenea**: si se coloca un hogar en la planta N, esa misma casilla (x,y) se reserva como conducto — no transitable, sin mobiliario — en todas las plantas por encima, hasta la última planta del edificio. Mismo tipo de restricción vertical que una escalera (posición fija repetida entre plantas consecutivas), pero el conducto no da paso, solo ocupa espacio. El exterior no cambia nada por esto — sigue sin dibujar tejados ni chimeneas, es 100% interno al bakeador de interiores.
- **Ventanas**: solo dejan pasar luz — nunca renderizan vista al exterior (el interior es instancia separada, no tiene sentido "ver" el mapa exterior desde dentro). Solo pueden aparecer en plantas con fachada al exterior — sótanos/bodegas nunca llevan ventana (regla de sitio por nivel de planta, igual que `bandaElevacionMin` en exteriores).
- **Ventanas y puertas como combinación de atributos, no variantes fijas**: para cubrir tamaño × altura × marco × forma × cristal sin tener que pintar cientos de combinaciones a mano, cada ventana compone varios ejes independientes (`forma`: rectangular/redonda/arco: `tamano`: pequeña/media/grande; `marco`: con/sin; `cristal`: liso/vidriera) en vez de un único campo `variantes` como en exteriores. El arte se compone por capas superpuestas (marco + hueco + cristal).
- **Balcón/galería interior de doble altura** — un piso superior con hueco que mira a la sala de abajo, típico de gran salón de castillo. Siempre interior, nunca un balcón que mire al mapa exterior.

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

## 10. Explícitamente descartado (para no reabrirlo sin motivo)

- **Muros en diagonal de verdad** — ver sección 2.
- **Orientación solar del edificio respecto al mapa** — nivel de simulación que no se nota jugando y complica la generación sin beneficio real.
- **Ventanas que renderizan vista al exterior** — el interior es instancia separada, no tiene sentido.
- **Balcones que dan al mapa exterior** — mismo motivo.

## 11. Fuera del alcance de este bakeador

- **Mazmorras/cuevas/dungeons** — geometría mucho más orgánica (BSP/autómata celular en vez de WFC con reglas de arquitectura civil), es un bakeador aparte. No reutilizar este diseño para eso sin pensarlo de nuevo.
- **Cálculo de sombras/iluminación en vivo** — el bakeador solo deja los datos (posición de fuentes de luz); el cálculo es del servidor en vivo.
- **Cono de visión del jugador entre salas** — apuntado en `Backlog_Mecanicas_Futuras.md`, es cálculo en vivo del cliente/servidor según posición y orientación del jugador, no responsabilidad del bakeador.

## 12. Estado actual

Diseño cerrado en esta fase de conversación. Catálogo (`interiores/catalogo/*.json`) en construcción — ver `interiores/README.md` para el estado exacto de qué hay ya escrito. El motor de generación (WFC + colocación de elementos) todavía no está construido; primero se rellena el catálogo, como se hizo con exteriores.
