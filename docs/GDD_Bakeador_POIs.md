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

## 4. Preguntas abiertas (sin decidir todavía)

- ¿El layout de calles/plazas es WFC, un algoritmo de subdivisión (BSP), o colocación orgánica tipo la de decoración de exteriores?
- ¿Cuántos edificios le tocan a un asentamiento según su tamaño/tipo (aldea_agricola vs. ciudad_poblada_menor vs. castillo)? — probablemente cada `tipoEdificio` de asentamiento (a definir, análogo a `tipoEdificio` en interiores) declare su propia lista de edificios típicos con pesos, mismo patrón que `salasPorPlanta`.
- ¿Hay NPCs/decoración ambiental propia del mapa de POI (puestos de mercado, pozos, fuentes) o se resuelve con el mismo catálogo de exteriores a escala reducida?
- ¿Cómo entra la muralla/cerca perimetral de un castillo o ciudad amurallada — estructura propia de este bakeador, o un `tipoEdificio` especial sin interior?

## 5. Estado actual

Concepto capturado y confirmado por el usuario, sin catálogo ni motor todavía. Es el siguiente esqueleto de diseño después de terminar de rellenar `interiores/catalogo/*.json` y de construir el motor de interiores — no bloquea ninguno de los dos.
