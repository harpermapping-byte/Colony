# Test Zone plana (`testflat`) — coordenadas

Pedido 2026-08-31: "un cuadrado pequeño de solo hierba, sin generación de
nada... coloca a mano todo lo que puedas para probar las mecánicas... ponlo
todo alrededor del spawn, en puntos separados a X distancia, cada uno en
una dirección". Mapa `testflat` (2x2 chunks = 64x64 casillas, semilla
`testflat-01`, bordes cerrados, bioma único `pradera`). Terreno forzado a
césped puro (`baker/config/testflat.json` + postproceso que vacía
`objetos`/`pois` de cada chunk y fuerza `terreno`/`elevacion` planos) — sin
POIs, sin fauna/vegetación bakeada salvo los 4 nodos colocados a mano.

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
| **Este, más lejos** | Portal a la aldea `testaldea` (ver abajo) | (58, 32) | ~26 |

## Aldea (`assets/mapas/testaldea/`)

Bakeada con `ciudades/` (motor v2 orgánico, tier `aldea_pequena`, semilla
`testaldea-01`) — 112x112 casillas, 8 edificios REALES con interior
bakeado y enlazado por portal (a diferencia de las mesas de `testflat`,
aquí SÍ son edificios completos con muralla, plaza, calles). Se entra
cruzando el portal de `testflat` en (58,32); el spawn dentro de la aldea es
su propio `ciudad` (73,41).

Nota Windows: los nombres de archivo de interiores originalmente traían
`:` (inválido en NTFS) — ya renombrados a `_` con las referencias de
`indice.json` actualizadas, mismo arreglo aplicado a `testzone`.

Población (2026-09-02, bug real encontrado jugando: "no sale la aldea" — sin
`poblacion.json` la aldea tenía 0 NPCs reales, así que `game.ts` activaba el
circuito de personajes DEMO de sitio fijo cerca del spawn, que se veía
exactamente igual en cualquier mapa sin población — parecía que el cliente
no había cargado nada nuevo al cruzar el portal): generada con
`node poblacion/src/exportarAsentamiento.js aldea_pequena testaldea-01 assets/mapas/testaldea`
(5 NPCs con rutina y vóxeles reales, committeada en `poblacion.json`).

## Pendiente

- Patrullas de bandidos reales (las de faja/economía, no el dummy de
  pruebas) requieren un `asentamiento_hostil` bakeado — fuera de alcance de
  esta pasada, ver nota ya existente en `docs/GDD_TestZone.md`.
