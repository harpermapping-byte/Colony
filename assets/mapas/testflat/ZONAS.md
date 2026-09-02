# Test Zone plana (`testflat`) — coordenadas

Pedido 2026-08-31: "un cuadrado pequeño de solo hierba, sin generación de
nada... coloca a mano todo lo que puedas para probar las mecánicas... ponlo
todo alrededor del spawn, en puntos separados a X distancia, cada uno en
una dirección". Mapa `testflat` (26x16 chunks de 8 = 208x128 casillas,
semilla `testflat-01`, bordes cerrados, bioma único `pradera`, agrandado
2026-09-02 — ver "Aldea fusionada" abajo). Terreno forzado a césped puro
(`baker/config/testflat.json` + postproceso que vacía `objetos`/`pois` de
cada chunk y fuerza `terreno`/`elevacion` planos) — sin POIs, sin
fauna/vegetación bakeada salvo los 4 nodos colocados a mano y el terreno
real de la aldea fusionada (x:80-192).

## Spawn
**(32.5, 32.5)** — centro exacto del mapa.

## Distribución (una dirección por mecánica)

| Dirección | Qué hay | Coordenadas | Distancia al spawn |
|---|---|---|---|
| **Norte** | 16 muebles/mesas — construcciones REALES en BD (`server/src/mundo/semillaTestZone.ts`), no decoración bakeada. 11 mesas de crafteo (una por cada uno de los 10 oficios, carpintero tiene 2) + cama, 2 instrumentos (laúd/tambor — para probar MIDI), silla, mesa de comedor. | x:28-34, y:12-18 | ~14-20 |
| **Sur** | 17 NPCs tutorial/lore que hablan (nombres reales de políticos, mismo catálogo que `testzone`) — sembrados en `npcs_tutoriales`, no hace falta colocarlos a mano. | x:24-40, y:44-48 | ~12-20 |
| **Este** | 8 cofres de mundo con stock infinito (7 categorías + 1 genérico) | x:44-48, y:30-34 | ~12-16 |
| **Oeste** | 4 nodos de recolección a mano: roble (madera), trébol (hierba), veta de hierro, conejo (caza) | x:16-18, y:32-34 | ~14-16 |
| **Noreste** | 2 dummies de combate, vida infinita/regenerable: "Muñeco de Pruebas" y "Bandido" (etiqueta genérica, mismo criterio que los bandidos de dungeon) | x:46-48, y:16 | ~20 |
| **Este, mucho más lejos** | Aldea fusionada (ver abajo) — sin portal que cruzar, se camina directo | x:80-192, y:0-112 | desde ~48 |

## Aldea fusionada (pedido 2026-09-02: "fusionar de verdad")

Hasta 2026-09-02 la aldea vivía en su propio mapa `assets/mapas/testaldea/`
(un `RegionRoom` aparte) y se entraba cruzando un portal en `testflat`
(58,32). El streamer pidió agrandar el propio suelo de `testflat` para que
la aldea "spawneara dentro" — ahora `testflat` (Hub) contiene DE VERDAD el
terreno/edificios/población de la aldea, con offset +80 en X, +0 en Y sobre
sus coordenadas originales: caminar del spawn (32.5,32.5) hacia el este
hasta la aldea cruza CERO rooms/portales, es un único mapa continuo.

**Cómo se hizo** (proceso de una sola vez, no forma parte del pipeline
normal — sin script permanente en el repo, documentado aquí por si hay que
repetirlo con otra aldea):
1. `baker/config/testflat.json` rehorneado a 26x16 chunks de 8 (antes 2x2
   de 32) — mismo `tamanoChunk` que usa `ciudades/` (8), imprescindible para
   que el offset caiga en un borde de chunk exacto. Con esto, **ojo**: el
   bake por defecto pone la `ciudad` (ancla de spawn) en el CENTRO del mapa
   si no se fija a mano — como el mapa ya no es cuadrado con centro en
   (32,32), hay que fijar `"ciudad": {"x":32,"y":32}` explícito en el
   config o el spawn se mueve solo.
2. El rebake se aplana a césped puro (mismo postproceso ad-hoc que ya usaba
   el `testflat` original 64x64: fuerza `terreno`/`elevacion` de cada chunk
   y vacía `objetos`/`pois`) — el bake crudo SÍ mete roca/río de verdad
   cerca de los bordes del mapa (`bordes: cerrado` empuja la elevación
   hacia arriba en una franja ancha, banda 6, `roca_inaccesible`), por eso
   hace falta el aplanado, igual que en el `testflat` original.
3. Los 196 chunks de `testaldea` se empalman encima con offset (+80,+0):
   terreno re-indexado carácter a carácter contra la leyenda (superset) de
   `testflat` (bakes distintos = leyendas base-36 distintas, aunque los 7
   terrenos de `testaldea` ya existían todos en la de `testflat`), objetos
   sin tocar (coordenadas locales al chunk, no cambian con el offset).
4. `indice.json` fusionado: se queda con `leyendaTerreno`/`ciudad`/`bordes`
   propios de `testflat`; se descartan AMBOS portales viejos (el de
   `testflat`->aldea y el de retorno aldea->`testflat`, ya vestigiales); se
   quedan (con offset) los 8 portales `tipo:"interior"` (las puertas de
   edificio) + `muralla`/`caminos`/`zonasVerdes`/`luces`/`edificios`.
5. `poblacion.json` de la aldea (5 NPCs con rutina) copiado con el mismo
   offset aplicado a TODAS sus coordenadas (`rutina[].punto` y
   `rutina[].camino[]` son coordenadas absolutas de mundo).
6. `interiores/*.json` de la aldea copiados tal cual a
   `assets/mapas/testflat/interiores/` (nombres de archivo ya únicos
   globalmente, incluyen la semilla — sin colisión, `testflat` no tenía
   carpeta `interiores/` propia).
7. **Cambio de código real, no solo datos**: `HubRoom.onCreate` no leía
   `poblacion.json` (solo `RegionRoom` lo hacía) — sin esto, los 5 NPCs con
   rutina de la aldea fusionada no habrían aparecido nunca en un mapa Hub.
   Arreglado en `server/src/rooms/HubRoom.ts` (mismo bloque que
   `RegionRoom.ts`, mismo `GestorAgentes` compartido).

Verificado end-to-end con servidor real (login admin + `admin:debug:teleport`
+ `portal:usar`) y Playwright: spawn en (32.5,32.5), 24 NPCs cargados (5 con
rutina de la aldea + 17 tutorial + 2 dummy) en la MISMA room, terreno de la
aldea intacto (adoquín/tierra/empalizada/solar_edificio/extramuros) sin
`roca_inaccesible` ni agua colándose en la zona existente ni en la aldea,
`portal:usar` en la puerta del templo (141,49) resuelve a
`{mapaId:"testflat", edificio:"templo_testaldea-01_templo_0"}` y el
`InteriorRoom` carga ese interior correctamente.

Nota Windows: los nombres de archivo de interiores originalmente traían
`:` (inválido en NTFS) — ya renombrados a `_` con las referencias de
`indice.json` actualizadas, mismo arreglo aplicado a `testzone`.

Población: generada con
`node poblacion/src/exportarAsentamiento.js aldea_pequena testaldea-01 assets/mapas/testaldea`
(5 NPCs con rutina y vóxeles reales) — ver "Aldea fusionada" arriba, esta
sesión resolvió también el bug de "no sale la aldea" (sin `poblacion.json`
el mapa se veía con 0 NPCs reales y el cliente activaba su circuito de
personajes DEMO de sitio fijo, indistinguible visualmente de un mapa vacío).

## Pendiente

- Patrullas de bandidos reales (las de faja/economía, no el dummy de
  pruebas) requieren un `asentamiento_hostil` bakeado — fuera de alcance de
  esta pasada, ver nota ya existente en `docs/GDD_TestZone.md`.
- `fauna.json` de la aldea (ganado/animales domésticos estáticos) NO se
  fusionó — solo `RegionRoom` lee `fauna.json` (`server/src/rooms/RegionRoom.ts`),
  `HubRoom` no tiene ese bloque todavía. No afecta a la caminabilidad ni a
  los NPCs con rutina (ya arreglado, ver arriba); si hace falta ganado en
  el Hub, replicar el mismo patrón que se usó para `poblacion.json`.
- El mapa `assets/mapas/testaldea/` en sí (el bake original de la aldea, no
  fusionado) se queda tal cual en el repo — es la fuente de la que se
  copió/offset todo lo de arriba, y sigue sirviendo como aldea standalone
  vía `?mapaId=testaldea` (sala `region`) si hiciera falta probarla aislada.
