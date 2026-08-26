# Bakeador de mapas exteriores — Streamer Colony

Genera mapas exteriores (bosques, llanuras, desiertos...) según el diseño de `docs/GDD_Bakeador_Exteriores.md`. Corre en tu PC, en local — el resultado se sube a GitHub y de ahí lo lee el juego. No necesita servidor de pago para nada de esto.

**Cero dependencias.** Todo el bakeador está escrito solo con Node.js estándar (sin `npm install`), a propósito, para que no haya líos de instalación como los que tuvimos al montar el prototipo del servidor.

## Requisitos

Solo Node.js 18 o superior instalado. Nada más.

## 1. Generar un mapa

```bash
cd baker
node src/index.js config/ejemplo-rapido.json
```

Esto genera un mapa pequeño (12x12 chunks) en unos segundos — úsalo primero para probar que todo funciona y para ver el resultado rápido antes de lanzar el mapa grande de verdad.

Cuando quieras el mapa principal (200x200 chunks, el tamaño de referencia que fijamos — **ojo, tardará bastante más**, es un mapa mucho más grande, es normal y esperado):

```bash
node src/index.js config/mapa-principal.json
```

El resultado se guarda en `output/<nombre-del-mapa>/`:
- `indice.json` — metadatos del mapa (semilla, tamaño, bordes, posición de la ciudad).
- `sector_XXX_YYY.json` — un archivo por cada 10x10 chunks (terreno + objetos + POIs de esos chunks).
- `mapa_general.png` — imagen de resumen de todo el mapa visto desde arriba, para revisar de un vistazo si la distribución de biomas/ríos/caminos te convence.
- `informe_validacion.txt` — te avisa si algún POI se quedó sin camino hasta la ciudad o si algo más no cuadra.

**Primero mira `mapa_general.png`.** Es la forma más rápida de juzgar si el mapa está bien — si algo se ve raro ahí, ajusta el archivo de configuración (semilla, densidades, biomas habilitados) y vuelve a generar antes de meterte a revisar con el visor.

## 2. Ver el mapa con la cámara libre (WASD)

El visor es una página web sola, sin instalar nada — pero el navegador no te deja abrir el archivo directamente por doble clic (restricción de seguridad de los navegadores, CORS), hace falta un servidor local muy simple. Dos opciones, la primera es la más fácil si tienes Python (viene instalado en casi cualquier PC/Mac):

```bash
# Opción A — con Python (ya viene instalado en la mayoría de sistemas)
cd baker
python3 -m http.server 8000

# Opción B — con Node, si no tienes Python
npx serve .
```

Con el servidor corriendo, abre en el navegador: **http://localhost:8000/visor/index.html**

- Elige el mapa en el desplegable de arriba a la derecha (aparecerá si ya lo horneaste en el paso 1).
- Muévete con **WASD** o las flechas, haz zoom con la rueda del ratón.
- El punto blanco marca la ciudad. Los cuadraditos rojos son POIs (dorados si son legendarios). Los puntitos verdes/amarillos/grises son vegetación/animales/rocas.
- Solo carga los sectores cerca de donde estás mirando (streaming por chunks, igual que hará el juego real) — así puedes "volar" por un mapa de 200x200 chunks sin que se cuelgue el navegador.

## 3. Ajustar el mapa

Todos los parámetros están en `config/*.json` — copia uno y crea el tuyo propio si quieres probar variaciones (otra semilla, más/menos biomas, mapa más pequeño para probar rápido). No hace falta tocar el código para nada de esto:

- `semilla`: cambia el mapa entero manteniendo las mismas reglas.
- `biomasHabilitados`: qué biomas de `catalogo/biomas.json` pueden aparecer en este mapa en concreto (GDD sección 3, "biomas habilitados por mapa").
- `anchoChunks` / `altoChunks`: tamaño del mapa.
- `separacionMinimaPOI`: cuánto espacio mínimo entre puntos de interés.
- `bordes`: qué hay en cada lado del mapa (`cerrado`, `mar_abierto`, `tierra_abierta` con un `nombre` para conectarlo a un mapa futuro).

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

- **Hidrología**: usa el algoritmo simple de "seguir la pendiente" (GDD sección 4), no la versión mejorada de erosión hidráulica por partículas — funciona bien, pero el relieve de los cauces es menos realista que la versión avanzada.
- **Catálogo de contenido**: `catalogo/*.json` trae un subconjunto representativo (no las ~300 especies completas de `docs/Catalogo_Especies_Exterior.md`) — se amplía añadiendo entradas nuevas a esos JSON, sin tocar el código.
- **No implementado todavía** (son efectos que el propio diseño define como "en vivo", no horneados — le tocan al servidor del juego más adelante, no a este bakeador): clima, estaciones, acumulación de nieve/charcos, sombras dinámicas, niebla de guerra, reproducción de fauna. El bakeador ya deja los datos que esos sistemas van a necesitar (posición de la ciudad, alturas, tipos de terreno), pero no calcula los efectos en sí.
- **Domain warping y suavizado**: implementados y activos, dan el aspecto orgánico que buscábamos (compáralo con un mapa de ruido puro sin estas dos técnicas y se nota la diferencia).
- **Tamaño de archivo**: con mapas grandes y mucha decoración, los sectores pesan varios cientos de KB a un par de MB cada uno — si el mapa de 200x200 casillas te sale muy pesado en total para GitHub, baja las `densidadBase` de `catalogo/vegetacion.json`/`animales.json`/`rocas.json`, es el ajuste más directo para reducir peso sin tocar el algoritmo.
