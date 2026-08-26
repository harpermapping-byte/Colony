# Bakeador de mapas exteriores — Streamer Colony

Genera mapas exteriores (bosques, llanuras, desiertos...) según el diseño de `docs/GDD_Bakeador_Exteriores.md`. Corre en tu PC, en local — el resultado se sube a GitHub y de ahí lo lee el juego. No necesita servidor de pago para nada de esto.

**Cero dependencias.** Todo el bakeador está escrito solo con Node.js estándar (sin `npm install`), a propósito, para que no haya líos de instalación como los que tuvimos al montar el prototipo del servidor.

## Requisitos

Solo Node.js 18 o superior instalado. Nada más.

## 1. Generar un mapa — interfaz gráfica (recomendado)

```bash
cd baker
node gui/servidor.js
```

Esto abre automáticamente tu navegador en una pantalla con el formulario — nombre, semilla, tamaño, qué biomas quieres, bordes del mapa, todo con botones y casillas, sin tocar JSON ni la terminal para nada más. Pulsa **"Generar mapa"** y verás el progreso en vivo; al terminar aparece la imagen de resumen ahí mismo, y un botón **"Abrir visor"** que te lleva directo a explorar ese mapa con cámara libre (WASD) — ya no hace falta el `python -m http.server` de antes, este mismo servidor sirve también el visor.

Cuando termines, el botón **"Cerrar"** apaga el servidor — o simplemente cierra la ventana de la terminal donde lo lanzaste.

Hay dos botones de preset (**rápido**, para probar en segundos, y **mapa principal**, el tamaño grande de 200x200 chunks que fijamos — tardará bastante más, es normal).

El resultado se guarda igual que siempre en `output/<nombre-del-mapa>/`:
- `indice.json` — metadatos del mapa (semilla, tamaño, bordes, posición de la ciudad).
- `sector_XXX_YYY.json` — un archivo por cada 10x10 chunks (terreno + objetos + POIs de esos chunks).
- `mapa_general.png` — imagen de resumen de todo el mapa visto desde arriba (terreno/bioma real).
- `mapa_elevacion.png` — el mismo mapa coloreado solo por banda de elevación (azul oscuro=mar profundo → blanco=cumbre), como un mapa topográfico — útil para ver el desnivel completo de un vistazo.
- `informe_validacion.txt` — te avisa si algo no cuadra (POIs sin camino, etc.).

## 1b. Generar un mapa — por terminal (alternativa, para scripts/automatizar)

Si prefieres seguir usando la terminal directamente:

```bash
cd baker
node src/index.js config/ejemplo-rapido.json      # mapa pequeño de prueba
node src/index.js config/ejemplo-bordes.json      # mapa pequeño con los 4 tipos de borde a la vez (mar, montaña, tierra, cerrado) — para ver el efecto de cada uno
node src/index.js config/mapa-principal.json      # el mapa grande de verdad
```

## 2. Ver el mapa con la cámara libre (WASD)

Si generaste el mapa con la interfaz gráfica, el botón "Abrir visor" ya te lleva ahí directo. Si generaste por terminal, con el servidor de la GUI corriendo (`node gui/servidor.js`) abre en el navegador: **http://localhost:4000/visor/index.html**

- Elige el mapa en el desplegable de arriba a la derecha.
- Muévete con **WASD** o las flechas, haz zoom con la rueda del ratón.
- El punto blanco marca la entrada a la ciudad. Los círculos rojos son POIs (dorados si son legendarios) con su tamaño real de ocupación. Los puntitos verdes/amarillos/grises son vegetación/animales/rocas.
- Solo carga los sectores cerca de donde estás mirando (streaming por chunks, igual que hará el juego real).

## 3. Ajustar el mapa

Todo lo que ves en el formulario de la interfaz gráfica también se puede editar directamente en `config/*.json` (copia uno y crea el tuyo propio). No hace falta tocar el código para nada de esto:

- `semilla`: cambia el mapa entero manteniendo las mismas reglas.
- `biomasHabilitados`: qué biomas de `catalogo/biomas.json` pueden aparecer en este mapa en concreto (GDD sección 3, "biomas habilitados por mapa").
- `anchoChunks` / `altoChunks`: tamaño del mapa.
- `separacionMinimaPOI`: cuánto espacio mínimo entre puntos de interés.
- `bordes`: qué hay en cada lado del mapa (`cerrado`, `mar_abierto`, `montana`, `tierra_abierta` con un `nombre` para conectarlo a un mapa futuro). El tipo influye de verdad en el terreno cercano a ese lado: `mar_abierto` empuja el mar hacia ahí (la costa se forma algo más adentro, dejando franja de agua real entre el borde y la orilla — con variedad de acantilados/playas/cabos según la zona), `montana`/`cerrado` levantan un muro de roca infranqueable, y `tierra_abierta` deja una frontera de tierra normal sin forzar nada.

El **contenido** (qué árboles, animales, rocas y POIs existen) está en `catalogo/*.json` — añadir una especie nueva es añadir una entrada nueva a esos archivos, no toca el código del bakeador (regla de extensibilidad del GDD, sección 19).

## 4. Sustituir los placeholders por tu propio arte

En la carpeta `assets/` (en la raíz del repo, no dentro de `baker/`) hay un archivo de imagen por cada especie/terreno del catálogo — son los placeholders reales, ya generados, listos para que sustituyas cualquiera por tu propia imagen (mismo nombre de archivo). Instrucciones completas en `assets/README.md`.

Si añades contenido nuevo al catálogo más adelante, genera los placeholders que falten con:

```bash
node src/generar_placeholders.js
```

Esto no toca los archivos que ya hayas sustituido por arte de verdad, solo crea los que falten.

## 5. Cuando el mapa te convenza

Sube la carpeta `output/<nombre-del-mapa>/` al repositorio (a `baker/output/` o donde decidamos que vive en el juego final) con un commit normal — es la forma de "instalarlo" en el juego, tal como planeamos desde el principio.

## Qué falta / simplificaciones de esta primera versión

Para que quede claro qué es fiel al diseño y qué está simplificado de momento:

- **Hidrología**: usa el algoritmo simple de "seguir la pendiente" (GDD sección 4), no la versión mejorada de erosión hidráulica por partículas — funciona bien, pero el relieve de los cauces es menos realista que la versión avanzada. Si el mapa no genera ningún lago natural, se fuerza una charca pequeña en el punto más bajo del interior para que nunca falte un cuerpo de agua quieta. **Arreglado**: los ríos se dibujaban asignando cada casilla a la celda de rejilla de hidrología más cercana (bloques cuadrados de hasta medio chunk) — se veían como cuadrados azules pegados, no como un río. Ahora se traza una línea fina real entre cada celda de río y aquella a la que fluye, con anchura según el caudal, y los lagos se rellenan como un círculo en vez de un cuadrado.
- **Mapa resumen (`mapa_general.png`) muestreado tile a tile**: antes pintaba un bloque de color entero por chunk (un río o camino fino salía como un cuadrado del tamaño de medio chunk) — ahora muestrea el terreno real varias veces dentro de cada chunk, así ríos, costas y caminos salen con su forma orgánica de verdad en el resumen, no solo en el visor.
- **Límite de caminos trazados a POIs escala con el tamaño del mapa**: antes era un número fijo (15-40) pensado para mapas pequeños — en un mapa grande con cientos de POIs, la inmensa mayoría se quedaban sin ni siquiera intentar un camino. Ahora, si no lo fijas a mano, se calcula a partir del área del mapa (tanto en la GUI como por dentro del bakeador).
- **Rendimiento de la decoración**: con el catálogo ya bastante grande, el colocador recalculaba qué especies encajan recorriendo el catálogo entero en cada casilla — ahora está indexado por bioma una sola vez al arrancar, no en cada casilla.
- **Bioma marino**: `mar_bajo` (franja costera menos profunda) y `mar_profundo` son automáticos — no aparecen como checkbox en la interfaz, se activan solos donde la elevación cae lo bastante (normalmente cerca de un borde `mar_abierto`, pero también puede salir un mar pequeño de pura casualidad del ruido). Tienen su propio catálogo de vida (peces de varios tamaños, depredadores, ballenas, pulpos, calamares, moluscos, crustáceos, estrellas y pepinos de mar, corales y algas) en `catalogo/vegetacion.json` y `catalogo/animales.json`. Ojo con el tiempo de horneado: decorar océanos enteros (donde antes no se procesaba nada por no ser terreno transitable) añade trabajo real — un mapa con un borde de mar grande puede tardar bastante más que uno completamente cerrado.
- **Caminos con tres carácteres según el desnivel**: tramo llano de verdad (misma banda de elevación en los dos extremos, sin montaña) → recto, sin ninguna curva de más; colinas suaves → la ondulación orgánica de siempre; sube de banda de montaña de verdad → zigzag real, más marcado cuanto más pronunciado el desnivel. No todos los caminos se curvan igual, como pediría el terreno real.
- **Densidad regional, no solo en bosque**: cada categoría (vegetación, fauna, rocas) tiene su propia capa de ruido de gran escala que hace que unas zonas salgan más pobladas/grandes y otras más ralas/pequeñas — antes solo aplicaba a los árboles de bosque, ahora aplica en todos los biomas (praderas con más o menos flores, tramos de desierto con más o menos rocas, etc.), y cada categoría varía de forma independiente para que no salgan siempre las mismas manchas juntas.
- **Variedad de terreno**: además de playa arenosa hay `playa_rocosa` (costas rocosas de verdad, elegido por una capa de ruido local), y `cesped_ralo` como transición real entre césped y tierra desnuda en pradera/bosque — no es un corte limpio de un tile al otro. `tierra_baldia` y `suelo_barbecho` ya están en el catálogo pero reservados para la futura mecánica de fertilidad del suelo (como `tierra_labrada`) — el bakeador no los pinta todavía en el mapa salvaje. También hay vegetación de relleno nueva (hierba alta, arbustos, setos, árboles jóvenes y viejos, corros de setas) para que el suelo no se vea tan vacío entre especies "grandes".
- **Reglas de sitio de los POIs**: `reglasSitio` (`terrenoLlano`, `cercaAgua`, `bandaElevacionMin`/`Max`) estaban declaradas en el catálogo pero nunca se comprobaban — se ha arreglado, así que ahora una cabaña de pesca de verdad sale cerca de agua y una cabaña de cazador de montaña de verdad sale en terreno alto. La elección de plantilla dentro de cada bioma ahora es ponderada por un campo `peso` (10 por defecto) en vez de uniforme, para poder tener tipos comunes y tipos raros/"TOP" de verdad conviviendo en el mismo pool.
- **Catálogo de POIs ampliado**: cuevas, mazmorras, ruinas en tres tamaños, aldeas (pescadores/agrícola/maderera), una ciudad poblada menor, mercado itinerante, caravana ambulante, circo, tiendas y cabañas de cazador/pesca, y toda una familia de POIs enemigos marcados con `faccion: "hostil"` (campamentos bárbaros pequeños/grandes, guarida de bandidos, cazadores furtivos, torre vigía, barracones, fuerte bárbaro, castillo en ruinas) — listos para que la futura mecánica de peligro/combate los reconozca. Los que pueden salir en cualquier bioma viven en `catalogo/pois.json` bajo la clave especial `"_cualquiera"`, que se suma siempre al pool del bioma en vez de tener que duplicarlos en cada uno.
- **Catálogo de contenido**: `catalogo/*.json` trae un subconjunto representativo (no las ~300 especies completas de `docs/Catalogo_Especies_Exterior.md`) — se amplía añadiendo entradas nuevas a esos JSON, sin tocar el código.
- **No implementado todavía** (son efectos que el propio diseño define como "en vivo", no horneados — le tocan al servidor del juego más adelante, no a este bakeador): clima, estaciones, acumulación de nieve/charcos, sombras dinámicas, niebla de guerra, reproducción de fauna. El bakeador ya deja los datos que esos sistemas van a necesitar (posición de la ciudad, alturas, tipos de terreno), pero no calcula los efectos en sí.
- **Domain warping y suavizado**: implementados y activos, dan el aspecto orgánico que buscábamos (compáralo con un mapa de ruido puro sin estas dos técnicas y se nota la diferencia).
- **Posición de la ciudad**: por defecto se coloca en el centro exacto del mapa, sin comprobar si ahí hay agua/terreno raro — en el `config` puedes fijar `ciudad: {x, y}` a mano si el centro te sale mal situado. Comprobarlo automáticamente es una mejora pendiente.
- **Tamaño de archivo**: con mapas grandes y mucha decoración, los sectores pesan varios cientos de KB a un par de MB cada uno — si el mapa de 200x200 casillas te sale muy pesado en total para GitHub, baja las `densidadBase` de `catalogo/vegetacion.json`/`animales.json`/`rocas.json`, es el ajuste más directo para reducir peso sin tocar el algoritmo.
