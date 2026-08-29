# Generador procedural de personajes/NPCs — decisión y estado (v1, 4 arquetipos de prueba)

Documento de referencia — léelo antes de tocar `personajes/` o ampliar su catálogo. Es el hermano de `GDD_Ropa_Procedural.md`: mismo patrón que el mobiliario de interiores (catálogo como fuente de verdad, generación determinista por semilla, offline).

## Decisión (confirmada con el streamer)

Antes de completar el catálogo de ropa, existe el **generador de personajes**: como con los muebles, habrá una **lista de NPCs** (catálogo) y el generador los va creando de ahí. La lista definitiva se pactará más adelante; ahora el catálogo arranca con **4 arquetipos de prueba** para validar el algoritmo — cuando la lista completa esté, se amplía `npcs.json` y se regenera todo del tirón sin tocar el generador.

Cada entrada de NPC declara su **ropa** (ids de `ropa/catalogo/prendas.json`): cuando el catálogo de prendas esté completo, el cliente generará y colgará esa ropa **auto** al materializar el NPC — misma morfología en la ficha, así que acopla sola (ver GDD_Ropa_Procedural, sección morfología).

Variedad exigida desde el primer momento: **pelos (estilo y color), alturas, complexiones, barbas, y colores de piel y ojos** distintos por individuo.

## Estructura

- `personajes/catalogo/rasgos.json` — diccionario global de rasgos: 6 estilos de pelo (calvo/rapado/corto/melena/coleta/monje), 4 de barba (ninguna/bigote/perilla/completa), 7 colores de pelo, 6 tonos de piel, 5 colores de ojos, pesos de sexo. Todo como listas `[id, peso, hex]` al estilo de `salasPorPlanta` de interiores.
- `personajes/catalogo/npcs.json` — LA LISTA (hoy: aldeano, herrero, guardia, anciano_sabio). Cada NPC: `profesion` (cruza con `ropa/catalogo/profesiones.json`), `morfologia` con **rangos** `[min,max]` de altura/corpulencia (cada individuo cae en un punto por semilla), overrides de pesos de rasgos (solo lo que cambie: el herrero sube `completa`, el anciano sube canoso/blanco), y `ropa`.
- `personajes/src/generarPersonaje.js` — el generador. Devuelve por individuo:
  - **`ficha`** (el contrato con el cliente): sexo, morfología concreta, colores (piel/pelo/ojos con id+hex), estilos (pelo/barba), profesión y ropa. El rig del cliente ya consume todo lo de la ficha: morfología (`OpcionesRig.morfologia`), `colorPiel`, `colorPelo`, `colorOjos`.
  - **`voxelesCabeza`**: pelo + barba en vóxeles colgando del pivote `cabeza`, mismo contrato `{x,y,z,color,zona,pivote}` que las prendas de `ropa/` — el cliente los fusiona en una geometría.
  - Los estilos de pelo/barba son **cajas normalizadas sobre la cabeza** (lado=1) voxelizadas a celdas de 1/6 — un estilo nuevo se da de alta en `rasgos.json` Y en `CAJAS_PELO`/`CAJAS_BARBA` del generador. El casquete superior nunca sobrevuela la cara (tope z=0.5): frente y ojos siempre visibles; el flequillo es una tira aparte.
  - Barba solo en hombres (decisión simple v1 — si un NPC necesita otra cosa, se pacta y parametriza).
  - **Todas las caras construidas, siempre** (regla del streamer, igual que en ropa — ver GDD_Ropa_Procedural punto 5): cada vóxel de pelo/barba y cada caja del cuerpo llevan sus 6 caras aunque queden tapadas; al fusionar en el cliente solo se pueden quitar caras interiores entre vóxeles adyacentes, nunca exteriores. Nada puede verse hueco desde ningún ángulo (buceo bajo agua translúcida incluido).
- `personajes/src/prueba_render_pj.js` — galería SVG de 8 individuos (cuerpo morfado con su piel + pelo/barba/ojos, orden de pintado del pintor) + `prueba_render_png.js` (Playwright global). Salida en `personajes/output/` (gitignored).

## Animales (v1.1) — el mismo creador para todo lo que tenga esqueleto

Decisión del streamer: este creador vóxel no es solo de PJs — **todo lo que tenga esqueleto (animales, insectos, aves...) sale de aquí**, tirando del listado de fauna que ya existe (`baker/catalogo/animales.json`, ~100 especies).

- `personajes/catalogo/animales_rig.json` — rig por especie: MISMOS ids que el catálogo del baker (el color base sale de su `colorDebug` — cero duplicados, el generador valida el cruce), `esqueleto` (plantilla), proporciones en casillas, `escala` por rango (variación individual por semilla) y rasgos (orejas/cuernos/cola/cresta/rayas/alas/antenas). HOY: 6 especies de prueba (conejo, lobo, vaca_salvaje, ciervo, gallina_salvaje, abeja) para validar las plantillas — cuando el streamer dé la orden, se etiqueta el listado entero y se genera todo del tirón.
- `personajes/src/generarAnimal.js` — 3 plantillas de esqueleto implementadas: **cuadrupedo** (cuerpo+4 patas+cabeza con hocico/orejas/cuernos/cola por rasgo), **ave** (cuerpo+2 patas+alas plegadas+pico/cresta/cola abanico) e **insecto** (cabeza+tórax+abdomen con rayas opcionales+6 patas+antenas+alas). Salida por individuo: `ficha` (especie, esqueleto, escala, color con tono individual, sexo, rasgos) + `piezas` como cajas colgando de PIVOTES con nombre (`cuerpo`/`cabeza`/`pataDelIzq`/.../`cola`/`alaIzq`) — mismo contrato que el rig humanoide: el cliente creará un grupo por pivote y animar será rotar pivotes (andar = patas en contrafase, volar = alas). Rasgos por sexo funcionan (cuernos ramificados del ciervo solo en machos).
- **v1.2 — 7 plantillas**: a las 3 primeras se sumaron **pez** (cuerpo fusiforme + caudal/dorsal/pectorales; `dorsal:"alta"` para tiburones; anclado por el vientre, el cliente lo coloca a su altura de nado), **serpiente** (6 segmentos en S con pivote propio cada uno para ondular, anillos y cascabel opcionales), **crustáceo** (caparazón ancho + pinzas + 6 patas + ojos en pedúnculo) y **anfibio** (cuerpo agachado, ancas plegadas, ojos saltones). Especies de prueba: pez_mediano, tiburón, culebra_de_agua, serpiente_de_cascabel, cangrejo, rana — 12 en total en `animales_rig.json` (6 + estas 6). Sin plantilla quedan casos raros del listado (medusa, pulpo, moluscos con concha, estrella de mar...) que se pactarán al etiquetar el listado completo.
- `personajes/src/prueba_render_animales.js` — galería (8 individuos, con zoom de encuadre por especie) sobre el render compartido `renderIso.js` (cajas con las 6 caras, regla del streamer).

## Razas por color (v1.3, pedido del streamer 2026-08-29)

Antes de esto cada especie tenía un único `colorDebug` con un jitter sutil de ±6% de brillo (mismo color, tono ligeramente distinto por individuo) — NO existían razas de verdad. Pedido: que especies como la vaca tengan variantes reales (negra, marrón, blanco y negro...) y que un rebaño pueda salir mezclado con esas variantes.

- `personajes/catalogo/animales_rig.json` — campo opcional `coloresPosibles: [[hex, peso], ...]` por especie, MISMO formato `[valor, peso]` que ya usa `rasgos.json` para pelo/piel/ojos de los NPC humanos, resuelto con el mismo helper `elegirPonderado` (`interiores/src/azar.js`). Cubierto hoy (las 5 especies domésticas/de granja del catálogo, ver fauna urbana más abajo): `vaca_salvaje`, `gallina_salvaje`, `perro`, `gato`, `gallo`. Especies sin el campo siguen igual que antes (colorDebug del baker + jitter) — no hace falta tocar el resto del listado.
- `personajes/src/generarAnimal.js` — si la especie declara `coloresPosibles`, se sortea la raza ENTERA por semilla (no solo un tono); el jitter individual (±6%) se aplica DESPUÉS, encima de la raza elegida — variedad dentro de la raza, no la sustituye.
- **Rebaños con razas mezcladas ya funciona**: `ciudades/src/fauna.js` (fauna doméstica urbana v1.3 — gallinas/vaca suelta/perros/gatos/algún gallo por poblado, ver `GDD_Agentes_Moviles.md`) genera una `semilla` distinta por individuo (`${ciudad.semilla}:fauna:${i}`), así que cada animal del mismo asentamiento tira su propia raza de forma independiente — un pueblo puede tener gallinas blancas, marrones y negras a la vez, o perros de razas distintas sueltos.
- **Pendiente honesto**: `oveja` NO tiene entrada en `animales_rig.json` todavía (solo existe `oveja_salvaje` en `baker/catalogo/animales.json`, sin rig/esqueleto) — cuando se le dé plantilla, añadir `coloresPosibles` ahí también es trivial. La fauna SALVAJE del mapa exterior (la que coloca `baker/decoracion.js` fuera de ciudades — lobos, ciervos, vacas_salvajes sueltas, jabalíes...) todavía se pinta como prop de color plano (`InstancedMesh`/`colorDebug`), no pasa por `generarAnimal`/rig — las razas por color de esta sección solo aplican, hoy, a la fauna doméstica urbana y a la galería de prueba de `personajes/`.

## Razas por tamaño y forma, no solo color (v1.4, pedido del streamer 2026-08-29)

Pedido explícito: "perros y gatos con razas diferentes (tamaños diferentes, colores y forma), estilo doberman/caniche/labrador" — un paso más allá de las razas por color de la sección anterior, que solo cambiaban el tono. Perro y gato son "lo más principal de compañero", así que llevan el tratamiento completo.

- `personajes/catalogo/animales_rig.json` — campo opcional `razas: [{id, peso, escala?, proporciones?, rasgos?, coloresPosibles?}, ...]` por especie. Cada raza SUSTITUYE los campos de la especie base SOLO en lo que declare (patrón "solo lo que cambie", igual que los overrides de NPC por profesión en `npcs.json`) — lo que no toque sale de la base. Se sortea una raza entera con `elegirPonderado`, igual que las razas por color.
  - **perro** (5 razas): `labrador` (grande, corpulento, dorado/negro/chocolate), `doberman` (alto, esbelto, orejas puntiagudas, negro/marrón oscuro), `caniche` (pequeño, patas cortas, cola en pomo, blanco/negro/albaricoque), `pastor` (mediano-grande, cuerpo alargado, negro y fuego/gris lobo/marrón), `callejero` (mestizo genérico, la base de siempre — sin sobreescribir nada).
  - **gato** (5 razas): `comun_europeo` (base, la de siempre), `siames` (esbelto, patas largas, cabeza fina, crema con puntas oscuras), `persa` (pequeño, rechoncho, patas cortas, cola en pomo, blanco/gris humo/crema), `maine_coon` (el más grande, cuerpo largo, atigrado/negro/gris), `angora` (esbelto, mayormente blanco).
- `personajes/src/generarAnimal.js` — `escalaRango`/`proporcionesBase`/`rasgosBase`/`coloresPosibles` se resuelven fusionando base+raza ANTES de aplicar el rango de escala y el jitter de color de siempre; `ficha.raza` expone el id de la raza elegida (`null` en especies sin `razas`). Especies sin el campo funcionan exactamente igual que antes — no hace falta tocar el resto del catálogo.
- **Bug real encontrado y corregido de paso**: la plantilla `cuadrupedo` no tenía entrada para `orejas: "caidas"` (la que usa `perro` desde siempre) en su tabla de alturas — la caja de la oreja salía con altura `NaN`. Añadido `caidas: 0.65` (entre `puntiagudas` y `largas`).
- **Verificado**: 200 individuos de muestra por especie reparten razas cerca de los pesos del catálogo; un pueblo real de prueba sacó perros labrador/doberman/caniche/callejero con escalas visiblemente distintas (0.45 a 0.89) en el mismo bake; cero piezas con `NaN` tras el fix.

## Animales de trabajo/monta: caballo, burro, buey (mismo pedido 2026-08-29)

`caballo_salvaje`/`burro_salvaje` (mapa exterior, población salvaje domesticable) ya existían, pero faltaba el **par doméstico urbano** — mismo hueco que ya se había resuelto para `oveja`/`carnero`. A diferencia de esos dos (y de `cerdo`/`ganso_domestico`), estos SÍ llevan rig completo desde ya:

- `caballo` — plantilla cuadrúpedo, patas largas, hocico largo, 5 capas de color (castaño/negro/blanco/palomino/pardo). Par doméstico de `caballo_salvaje`, que se mantiene igual.
- `burro` — mismo esqueleto, orejas largas (rasgo distintivo), capas más apagadas. Par doméstico de `burro_salvaje`, que se mantiene igual. **Sustituye a `mulo`** (ver nota abajo).
- `buey` — el más corpulento, con cuernos cortos (par de labranza de `vaca_salvaje`) — a diferencia de caballo/burro sí lleva `categoriaRecursoCarne`/`categoriaRecursoPiel` (un buey retirado se aprovechaba de verdad).

Añadidos a `baker/catalogo/animales.json` (patrón urbano `biomas: []`, como perro/gato/gallo) y enganchados ya a `ciudades/src/fauna.js` (pesos bajos: son animales caros de mantener, no todas las casas tienen uno). Verificado con un bake real de pueblo: aparecen sin `NaN` y con vóxeles completos.

**Por qué `mulo` se retiró**: se añadió primero (mismo pedido de "animales de trabajo"), pero justo después el streamer pidió un sistema de trío macho/hembra/cría de cara a una futura mecánica de reproducción — y el mulo es un híbrido de caballo+burro biológicamente estéril, no encaja ahí. Se quitó `mulo`/`mula` de `baker/catalogo/animales.json`, `personajes/catalogo/animales_rig.json` y `ciudades/src/fauna.js`, y `burro` (que sí se reproduce de verdad, y ya tenía `burro_salvaje` esperando su par) ocupa su sitio con el mismo rig adaptado.

## Convención de trío macho/hembra/cría, y su extensión a fauna salvaje (mismo pedido 2026-08-29)

Pedido explícito, con ejemplo: "si más adelante digo añadimos el cerdo, pues cerdo, cerda, cerdito se debe crear" — y después extendido: "también los animales salvajes deben tener esta regla... macho hembra y cachorro". Es una convención de **catálogo**, no de generación: cada trío es tres entradas nuevas en `baker/catalogo/animales.json` (nombre real cuando existe en español — toro/vaca, caballo/yegua, cerdo/cerda —, o flexión de género normal si no — perro/perra, gato/gata) más UNA sola cría común a ambos sexos (el sexo se decide al llegar a adulto, nunca "cría macho"/"cría hembra").

- **Doméstico** (+16, completando los pares que ya existían): `perra`/`cachorro`, `gata`/`gatito`, `pollito` (de gallina_salvaje/gallo), `yegua`/`potro`, `toro`/`vaca`/`ternero` (bovina doméstica completa junto a `buey`), `cerda`/`cerdito`, `oca`/`ansarino`, `cordero`, `burra`/`burrito`.
- **Salvaje** (+12, solo la fauna de caza/campo pedida explícitamente, NO todo el catálogo): `jabalina`/`jabato`, `cierva`/`cervatillo`, `corza`/`corcino`, `macho_cabrio`/`cabrito` (`cabra` YA era el nombre real de la hembra, así que aquí se añadió el macho), `oca_salvaje`/`ansarino_salvaje`, `ratona_de_campo`/`ratoncillo_de_campo`. Llevan `densidadBase`/`capacidadMaximaPorChunk` en 0 a propósito — repartir la densidad real de spawn entre macho/hembra/cría sin triplicar la población de cada especie es una decisión de diseño que no se ha tomado todavía; hoy jabalí/ciervo/corzo/cabra/ganso_salvaje/raton_de_campo siguen spawneando exactamente igual que antes.

Regla anotada como PERMANENTE dentro del propio `baker/catalogo/animales.json` (`_nota_convencion_macho_hembra_cria_2026_08_29` y `_nota_convencion_salvaje_macho_hembra_cria_2026_08_29`) para que cualquier especie doméstica o de caza/campo que se añada de aquí en adelante lleve su trío sin que haga falta volver a pedirlo. Ninguna de las 28 entradas nuevas tiene esqueleto todavía — es la base para un futuro sistema de cría entre animales de la misma especie y sexo distinto, no la mecánica en sí.

## Marchas embebidas (regla del streamer, acordada 2026-08-27)

**Todo lo que tiene esqueleto lleva SIEMPRE tres marchas de serie: parado, andar y correr** — aunque hoy nadie corra. API única `actualizar(dt, marcha)` con marcha 0/1/2 (boolean sigue valiendo como andar/parado) tanto en `rigHumanoide.ts` como en `animalVoxel.ts`. Correr = mismo ciclo acelerado y ampliado (zancada más larga y rápida, torso inclinado en humanos; galope con rebote en cuadrúpedos/aves/anfibios; coleteo/ondulación más fuertes en peces/serpientes) — funciona en los 7 esqueletos sin código por especie, con rampas suaves entre marchas.

**El disparo es automático por velocidad**: el cliente deduce la marcha del hueco hasta el destino de servidor en cada patch (andar deja ~0.25 casillas; más de 0.34 = corriendo). Cuando una mecánica futura haga correr a algo (sprint, huida de un ciervo, montura al galope), la animación se activa SOLA — cero cableado nuevo. Las acciones concretas (atacar, recolectar...) se triggearán más adelante sobre esta misma API.

## Verificado (v1)

- **Determinismo**: misma semilla+npcId → ficha idéntica (comprobado programáticamente).
- **Distribución**: 500 aldeanos → los rasgos salen clavados a los pesos del catálogo (corto 38% con peso 35, melena 24% con peso 25, sexo 50/50, marrón de ojos 45%...).
- **Visual**: galería con los 8 de prueba — se distinguen a simple vista alturas, anchuras, calvos/melenas/coletas/monje, barbas, canosos, tonos de piel y colores de ojos. El herrero sale ancho y barbudo, el guardia rapado/corto, el anciano menudo y cano — los overrides por NPC funcionan.

## Qué falta (pendiente, no bloquea)

- **La lista definitiva de NPCs** (la pacta el streamer). Al llegar: ampliar `npcs.json` + regenerar. Nada más.
- ~~Vestir auto en el cliente~~ — **HECHO (v1.3, el "materializado")**: `client/src/render3d/personajeVoxel.ts` crea el rig con la ficha (morfología+colores), fusiona pelo/barba y CADA prenda en una malla por pivote (`voxelMalla.ts`, color por vértice, un draw call por pivote, todas las caras) y la cuelga del pivote que declaran sus vóxeles — hereda la animación gratis. `animalVoxel.ts` hace lo mismo con animales: un grupo de Three por pivote con su origen de giro deducido (patas desde la cadera, alas desde el flanco, cola desde su unión) e idle por esqueleto (cola que se mueve, alas de insecto batiendo a 22hz, coleteo de pez, ondulación de serpiente por segmento, pinzas, respiración) + ciclo de andar genérico por contrafase listo para cuando se muevan. Los generadores emiten ahora `tam` (tamaño de celda) por vóxel con (x,y,z) = CENTRO — contrato exacto, el cliente no adivina resoluciones. El circuito entero está validado en el juego real: `personajes/src/exportar_demo.js` escribe `assets/personajes/demo_personajes.json` (3 NPCs vestidos con las 3 prendas según su profesión + 5 animales) y `game.ts` los materializa en una plaza junto al spawn de la ciudad — captura en el e2e de streaming. Cuando el servidor pueble NPCs de verdad consumirá este MISMO formato y la plaza demo desaparece.
- **Estilos de pelo femeninos propios** (trenzas, recogidos) y parametrizar barba/estilos por sexo si hace falta más finura que "barba solo hombres".
- **Dónde vive la semilla de cada NPC del mundo** (¿del bake de POIs/interiores? ¿del servidor al poblar?) — misma pregunta abierta que el spawn de fauna.
