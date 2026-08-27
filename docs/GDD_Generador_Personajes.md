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
- `personajes/src/prueba_render_pj.js` — galería SVG de 8 individuos (cuerpo morfado con su piel + pelo/barba/ojos, orden de pintado del pintor) + `prueba_render_png.js` (Playwright global). Salida en `personajes/output/` (gitignored).

## Verificado (v1)

- **Determinismo**: misma semilla+npcId → ficha idéntica (comprobado programáticamente).
- **Distribución**: 500 aldeanos → los rasgos salen clavados a los pesos del catálogo (corto 38% con peso 35, melena 24% con peso 25, sexo 50/50, marrón de ojos 45%...).
- **Visual**: galería con los 8 de prueba — se distinguen a simple vista alturas, anchuras, calvos/melenas/coletas/monje, barbas, canosos, tonos de piel y colores de ojos. El herrero sale ancho y barbudo, el guardia rapado/corto, el anciano menudo y cano — los overrides por NPC funcionan.

## Qué falta (pendiente, no bloquea)

- **La lista definitiva de NPCs** (la pacta el streamer). Al llegar: ampliar `npcs.json` + regenerar. Nada más.
- **Vestir auto en el cliente**: materializar NPC = crear rig con su ficha + fusionar `voxelesCabeza` + generar y colgar su `ropa` (bloqueado por completar el catálogo de prendas — a propósito).
- **Estilos de pelo femeninos propios** (trenzas, recogidos) y parametrizar barba/estilos por sexo si hace falta más finura que "barba solo hombres".
- **Dónde vive la semilla de cada NPC del mundo** (¿del bake de POIs/interiores? ¿del servidor al poblar?) — misma pregunta abierta que el spawn de fauna.
