# Test Zone — coordenadas de las 5 zonas

Mapa `testzone` (10×10 chunks, 320×320 casillas, semilla `testzone-01`, bordes cerrados). Las 5 zonas están agrupadas en un mismo bolsón de terreno caminable en el cuadrante sureste del mapa, todas a pocos pasos entre sí (radio ~20 casillas desde el spawn), con bosque, veta rocosa/montaña, animales de caza y lago de pesca alrededor para que la Zona 1 tenga de todo cerca.

## Spawn recomendado
- **x = 220, y = 270** (césped abierto, sin agua ni roca cerca).

## Zonas

| Zona | Uso | x | y | Notas |
|---|---|---|---|---|
| 1 | Recolección | 206 | 258 | Césped junto a bosque/roca/lago: se han verificado árboles (serbal, fresno, tejo, avellano...), vetas (carbón, pizarra, cuarzo, mármol), caza (oveja salvaje, liebre, marta...) y pesca (perca_lago, carpa_lago) en los chunks colindantes. |
| 2 | Crafteo | 234 | 266 | Puerta del edificio "taller" (interior bakeado aparte, ver abajo). |
| 3 | Almacenamiento | 228 | 280 | 8 cofres de mundo con stock infinito (`assets/mapas/testzone/contenedoresTest.json`, servidor `server/src/mundo/contenedoresTest.ts`): herramientas/armas/armaduras/ropa/comida/pociones/materiales + 1 genérico. |
| 4 | Construcción | 219 | 276 | Centro de la parcela `p_0001` (`parcelas.json`), 6×6 casillas llanas (x:216–221, y:273–278), sin restricción de oficio. |
| 5 | Combate | 236 | 280 | Dummy de combate fijo (`npcsFijos.json`, slotId `dummy_1`, oficio `dummy_combate`). |

## Zona 2 — edificio "taller" (detalle)

- Interior bakeado con `interiores/`: tipo de edificio `carpinteria`, semilla `testzone-taller-01`, guardado en `interiores/output/testzone_taller.json` y copiado a `assets/mapas/testzone/interiores/carpinteria_testzone-taller-01.json`.
- Portal enlazado a mano en `indice.json` → `portales` (mismo mecanismo que usa `ciudades/`, ver `docs/GDD_Sistema_Puertas.md`): `{"tipo":"interior","x":234,"y":266,"edificio":"carpinteria_testzone-taller-01","tipoEdificioId":"carpinteria"}`.
- La planta baja salió con DOS salas de tipo `taller` (riqueza `noble`). Ronda 1 cubrió los 4 niveles reales del catálogo (`interiores/catalogo/elementos.json`: **1, 4, 6, 8**, no hay 1/2/3/4 literales) con mesas de carpintero/curtidor/picapedrero. Ronda 2 (pedido 2026-08-31 "mesas para poder probar si hacen los crafteos según profesión") añadió una estación más por cada oficio que faltaba, para tener **los 10 oficios de jugador representados**:
  - `mesa_despiece` (curtidor, nivel 1) — generador normal.
  - `mesa_delineante` (ingeniero, nivel 1) — forzada a mano.
  - `mesa_tajado_limpieza` (molinero, nivel 1) — forzada a mano.
  - `estacion_despiece_caza` (cazador, nivel 1) — forzada a mano.
  - `fogon_campamento` (cocinero, nivel 1) — forzada a mano.
  - `forja_campo` (herrero, nivel 1) — forzada a mano.
  - `mesa_mampuesto` (picapedrero, nivel 4) — generador normal (forzada en ronda 1).
  - `mesa_diagnostico` (curandero, nivel 4 — el más bajo que tiene el oficio) — forzada a mano.
  - `mesa_talla_fina` / `mesa_ensamblaje` (carpintero, niveles 6/8) — generador normal.
  - `mesa_engarce` (joyero, nivel 6 — el más bajo que tiene el oficio) — forzada a mano.
  Las 11 mesas están repartidas entre las dos salas `taller`, accesibles desde la puerta de la Zona 2 sin cruzar ninguna otra sala bloqueada. Todas `origen:"modificado"` menos las 4 que ya generó el motor normal — edición no destructiva, sobreviven a una regeneración del edificio.

## NPCs con movimiento / patrullas (pedido 2026-08-31)

No hay ninguna patrulla bandida "de verdad" en esta zona — esas exigen un asentamiento_hostil bakeado con `ciudades/` (guarnición en BD, caminos A* de plaza-a-puerta, ver `docs/GDD_Faccion_Bandidos.md` §7ter) y montarlo aquí sería desproporcionado para un mapa de pruebas. Lo que SÍ hay, sin ningún código nuevo, reusando el 100% de lo existente:

- **Fauna salvaje viva** en todo el mapa exterior (`GestorFauna`, ya activo en cualquier región — se ve en los logs del servidor "Fauna salvaje en vivo activada"): oveja salvaje, liebre, marta... alrededor de la Zona 1, cazables/atacables de verdad.
- **POIs hostiles ya bakeados automáticamente** por el propio baker exterior, cada uno con sus enemigos reales dentro (vía el mismo sistema de mazmorras/asentamientos que usa el juego en producción — RegionRoom + fauna.json del POI): el más cercano al spawn es **`cueva_pequena` (cueva de goblins) a ~37 casillas** (dirección noroeste desde 220,270), luego `asentamiento_cultistas_poi` (~61 casillas) y `ruinas_biblioteca_arcana_poi` (~73 casillas). Sirven para probar combate/loot contra NPCs hostiles reales sin salir del entorno compacto de la Test Zone.

## Verificación de terreno

Las 5 coordenadas y el spawn están dentro del mismo componente conectado de casillas caminables (`cesped`/`cesped_b`/`cesped_c`/`tierra`/`camino`, sin agua ni roca), comprobado con flood-fill sobre el bake real. Ninguna cae sobre un `solar_edificio` de los POIs que colocó el propio bakeador exterior.
