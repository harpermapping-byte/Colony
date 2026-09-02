# Test Zone plana (`testflat`) — coordenadas

Pedido 2026-08-31/2026-09-02: "mapa de pruebas con TODAS las mecánicas".
Mapa `testflat` expandido (6x6 chunks = 192x192 casillas, semilla
`testflat-01`, bordes cerrados, bioma único `pradera`). Terreno forzado a
césped puro (`baker/config/testflat.json` + postproceso que vacía
`objetos`/`pois` de cada chunk y fuerza `terreno`/`elevacion` planos) — sin
POIs, sin fauna/vegetación bakeada.

## Spawn
**(96.5, 96.5)** — centro exacto del mapa expandido.

## Distribución (una dirección por mecánica)

| Dirección | Qué hay | Coordenadas | Distancia al spawn |
|---|---|---|---|
| **Norte** | 16 muebles/mesas de CRAFTEO — construcciones REALES en BD. 11 mesas (10 oficios + carpintero x2) + cama, 2 instrumentos (laúd/tambor), silla, mesa de comedor. | x:92-98, y:76-82 | ~14-20 |
| **Sur** | 17 NPCs tutorial/lore que hablan (políticos reales). | x:88-104, y:140-148 | ~44-52 |
| **Este** | 12 cofres de mundo con stock infinito: herramientas, armas, armaduras, ropa, pociones, misc + NEW semillas, ingredientes cocina, fibras tela, materiales construcción. | x:108-144, y:94-98 | ~12-48 |
| **Oeste** | 4 nodos de recolección a mano: roble (madera), trébol (hierba), veta de hierro, conejo (caza). Expandible. | x:60-70, y:94-98 | ~26-36 |
| **Noreste** | 2 dummies de combate, vida infinita. | x:130-132, y:64-66 | ~40-42 |
| **Sureste** | COCINA — construcciones reales: horno, mesas despiece, alacena, mesa comedor. Prueba cocinero/consumibles/descanso. | x:118-122, y:140-142 | ~24-28 |
| **Suroeste** | SASTRERÍA — construcciones reales: telar, banco costura. Prueba confección/ropa. | x:70-74, y:140-142 | ~44-48 |
| **Noreste lejano** | CULTIVOS — herramientas: almácigos, compostador. Espacio abierto para pruebas de plantación/cosecha. | x:146-152, y:96-102 | ~50-56 |
| **Noroeste lejano** | ANIMALES domesticados (pendiente de baking). Zona de fauna: caballos, cabras, ovejas domesticadas para probar monturas/mascotas. | x:54-70, y:64-80 | ~26-40 |
| **Este lejano** | Portal a la aldea `testaldea` | (150, 96) | ~54 |

## Aldea (`assets/mapas/testaldea/`)

Bakeada con `ciudades/` (motor v2 orgánico, tier `aldea_pequena`, semilla
`testaldea-01`) — 112x112 casillas, 8 edificios REALES con interior
bakeado y enlazado por portal. Se entra cruzando el portal de `testflat` en
(150, 96); el spawn dentro de la aldea es su propio `ciudad` (73,41).

## Objetos en suelo para recoger

Pendiente de siembra: objetos recolectables dispersos alrededor de las
zonas de nodos (oeste) para probar recogida desde el suelo (madera, piedra,
hierba, carnes).

## Pendiente

- Población de la aldea (`poblacion.json`) — se generaría con
  `node poblacion/src/exportarAsentamiento.js aldea_pequena testaldea-01 assets/mapas/testaldea`
  si se quiere gente con rutina caminando dentro.
- Patrullas de bandidos reales — requieren un `asentamiento_hostil` bakeado.
- Animales domesticados en zona noroeste — baking + colocación en fauna.
- Verificación de que TODAS las mecánicas funcionan con Playwright.
