# Test Zone — coordenadas de las 5 zonas

Mapa `testzone` (10×10 chunks, 320×320 casillas, semilla `testzone-01`, bordes cerrados). Las 5 zonas están agrupadas en un mismo bolsón de terreno caminable en el cuadrante sureste del mapa, todas a pocos pasos entre sí (radio ~20 casillas desde el spawn), con bosque, veta rocosa/montaña, animales de caza y lago de pesca alrededor para que la Zona 1 tenga de todo cerca.

## Spawn recomendado
- **x = 220, y = 270** (césped abierto, sin agua ni roca cerca).

## Zonas

| Zona | Uso | x | y | Notas |
|---|---|---|---|---|
| 1 | Recolección | 206 | 258 | Césped junto a bosque/roca/lago: se han verificado árboles (serbal, fresno, tejo, avellano...), vetas (carbón, pizarra, cuarzo, mármol), caza (oveja salvaje, liebre, marta...) y pesca (perca_lago, carpa_lago) en los chunks colindantes. |
| 2 | Crafteo | 234 | 266 | Puerta del edificio "taller" (interior bakeado aparte, ver abajo). |
| 3 | Almacenamiento | 228 | 280 | Punto libre en césped — el otro agente coloca aquí los cofres (implementación en servidor, fuera de este alcance). |
| 4 | Construcción | 219 | 276 | Centro de la parcela `p_0001` (`parcelas.json`), 6×6 casillas llanas (x:216–221, y:273–278), sin restricción de oficio. |
| 5 | Combate | 236 | 280 | Dummy de combate fijo (`npcsFijos.json`, slotId `dummy_1`, oficio `dummy_combate`). |

## Zona 2 — edificio "taller" (detalle)

- Interior bakeado con `interiores/`: tipo de edificio `carpinteria`, semilla `testzone-taller-01`, guardado en `interiores/output/testzone_taller.json` y copiado a `assets/mapas/testzone/interiores/carpinteria_testzone-taller-01.json`.
- Portal enlazado a mano en `indice.json` → `portales` (mismo mecanismo que usa `ciudades/`, ver `docs/GDD_Sistema_Puertas.md`): `{"tipo":"interior","x":234,"y":266,"edificio":"carpinteria_testzone-taller-01","tipoEdificioId":"carpinteria"}`.
- La planta baja salió con DOS salas de tipo `taller` (riqueza `noble`). Entre ambas están las 4 mesas de crafteo de referencia, una por cada nivel real presente en el catálogo (`interiores/catalogo/elementos.json` no tiene niveles 1/2/3/4 literales — los niveles reales son **1, 4, 6, 8** — se cubrió uno de cada):
  - `mesa_despiece` (curtidor, nivel 1) — forzada a mano (`origen:"modificado"`), el generador normal no la había colocado.
  - `mesa_mampuesto` (picapedrero, nivel 4) — forzada a mano (`origen:"modificado"`).
  - `mesa_talla_fina` (carpintero, nivel 6) — ya salió del generador normal.
  - `mesa_ensamblaje` (carpintero, nivel 8) — ya salió del generador normal.
  Las 4 están en salas `taller` de planta baja, accesibles desde la puerta de la Zona 2 sin cruzar ninguna otra sala bloqueada.

## Verificación de terreno

Las 5 coordenadas y el spawn están dentro del mismo componente conectado de casillas caminables (`cesped`/`cesped_b`/`cesped_c`/`tierra`/`camino`, sin agua ni roca), comprobado con flood-fill sobre el bake real. Ninguna cae sobre un `solar_edificio` de los POIs que colocó el propio bakeador exterior.
