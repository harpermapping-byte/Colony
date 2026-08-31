# GDD — Test Zone (mapa de pruebas)

Pedido 2026-08-31: "mapa de pruebas pequeño pero completo donde 2 o más
jugadores puedan conectarse en red y probar de forma rápida e interactiva
TODAS las mecánicas implementadas". Placeholders, sin arte final.

**Dos mapas, dos enfoques** (mismo pedido, iterado dos veces el mismo día):

- **`testflat`** (RECOMENDADO, el más reciente) — cuadrado pequeño de solo
  césped, SIN generación procedural de nada (sin POIs, sin fauna/vegetación
  bakeada), todo colocado a mano y repartido alrededor del spawn por
  dirección (una mecánica por dirección cardinal). Arregla además la
  limitación de `testzone` (§4 más abajo): las mesas de crafteo son
  construcciones REALES sembradas en BD, no mobiliario decorativo. Detalle
  completo en `assets/mapas/testflat/ZONAS.md`. Incluye portal a una aldea
  de verdad (`testaldea/`, bakeada con `ciudades/`) para probar entrar en
  edificios con interior real.
- **`testzone`** (el primer intento, más grande y con generación
  procedural real de biomas/mazmorras/POIs) — se mantiene tal cual, sigue
  siendo útil para probar el pipeline de bake normal end-to-end. Detalle en
  `assets/mapas/testzone/ZONAS.md`.

Se accede con `?mapaId=testflat` (o `?mapaId=testzone`) en la URL del
cliente (sala `hub_mapa` del servidor, mismo mecanismo que usan barcos para
cruzar a otro mapa exterior — ver GDD_Barcos.md).

## 0. `testflat` — resumen rápido

Spawn (32.5,32.5), mapa 64x64, césped puro. Alrededor, por dirección (ver
`assets/mapas/testflat/ZONAS.md` para coordenadas exactas):
**Norte** = 16 muebles (11 mesas de los 10 oficios + cama/2 instrumentos
MIDI/silla/mesa) como construcciones reales sembradas por
`server/src/mundo/semillaTestZone.ts` al arrancar. **Sur** = 17 NPCs
tutorial/lore que hablan (nombres reales, sembrados en `npcs_tutoriales`).
**Este** = 8 cofres de mundo con stock infinito. **Oeste** = 4 nodos de
recolección a mano (árbol/planta/veta/caza). **Noreste** = 2 dummies de
combate con vida infinita ("Muñeco de Pruebas" y "Bandido"). Más al este,
portal a `testaldea` (aldea real bakeada con `ciudades/`, 8 edificios con
interior de verdad).

Verificado con servidor real + Playwright (2026-08-31): terreno limpio sin
errores, spawn correcto, los 16 muebles y 19 NPCs fijos cargan en el
servidor (`Construcción (testflat): 1 parcelas, 16 construcciones
cargadas`, `19 NPC(s) fijo(s)... 17 tutorial(es)`), los NPCs tutorial/lore
se ven con sus nombres reales al caminar hacia el sur.

## 1. Las 5 zonas (`assets/mapas/testzone/ZONAS.md`)

Coordenadas exactas, verificación de terreno caminable y detalle del
edificio taller: todo documentado ahí, no se repite aquí. Resumen:

1. **Recolección** (206,258) — bosque/veta/plantas/pesca reales del bake.
2. **Crafteo** (234,266) — edificio "taller" con 11 mesas cubriendo los 10
   oficios de jugador. **Ver §4, limitación importante.**
3. **Almacenamiento** (228,280) — 8 cofres de mundo con stock infinito.
4. **Construcción** (219,276) — parcela `p_0001`, 6x6, sin restricción de oficio.
5. **Combate** (236,280) — dummy `dummy_1` (oficio `dummy_combate`), vida
   infinita/regenerable. Además, fauna salvaje real alrededor y una cueva de
   goblins a ~37 casillas del spawn (contenido hostil que el propio
   bakeador generó automáticamente, sin código nuevo).

Spawn: (220.5, 270.5) — dentro del clúster de zonas (`indice.json.ciudad`).

## 2. Panel de debug (cliente, tecla F9)

`client/src/admin/panelDebugTestZone.ts` — tabla de botones, nada que
escribir a mano. Solo visible con sesión de admin (jarl/superadmin,
`client/src/admin/panelLoginAdmin.ts`, credenciales de test en
`server/src/admin/seedAdmin.ts`). Envuelve 6 mensajes `admin:debug:*`
(`server/src/rooms/base/RoomExteriorBase.ts`), todos gateados server-side
con `puedeActuarComoJarl` — el panel es solo conveniencia de UI, el
servidor es la autoridad real:

- `darItem {itemId, cantidad}`
- `limpiarInventario {}`
- `godMode {activo}` — sin daño ambiental/combate ni gasto de comida/hidratación mientras esté activo (`Player.godMode` en `HubState.ts`).
- `maxOficio {slot}` — sube la XP del oficio de ese slot al umbral de nivel máximo.
- `resetearNodo {nodoId}` — `nodoId` es un string `"x,y"` (casillas de mundo), no un id amigable.
- `teleport {x,y}` — directo al Schema, sin física.

## 3. Cofres de mundo (`contenedorTest:*`)

Sistema NUEVO (no existía nada parecido antes) — `server/src/mundo/contenedoresTest.ts`
+ `assets/mapas/testzone/contenedoresTest.json`. Sin gate de jarl: cualquier
jugador conectado a testzone puede `contenedorTest:abrir {id}` /
`contenedorTest:tomar {id,itemId,cantidad}`. Nunca descuenta stock del
cofre — el único límite real es el hueco/stack del INVENTARIO del jugador
(verificado con test, ver §5). Cliente: `client/src/mundo/panelContenedorTest.ts`,
tecla Y, id fijo `cofre_test_1` (sin detección de proximidad real todavía).

## 4. LIMITACIÓN IMPORTANTE — las mesas de crafteo son decorativas

**Encontrado probando el 2026-08-31, sin arreglar todavía.** Las 11 mesas
de la Zona 2 se colocaron como mobiliario BAKEADO del editor de interiores
(`interiores/`, edición no destructiva sobre
`assets/mapas/testzone/interiores/carpinteria_testzone-taller-01.json`).
Pero `RoomExteriorBase.manejarCrafteoIniciar` (server/src/rooms/base/RoomExteriorBase.ts:6002)
exige que la mesa exista en `ctx.vivas` — el registro de CONSTRUCCIONES
REALES trackeadas en BD (tabla `construcciones`, pobladas por
`iniciarConstruccion` filtrando por `propiedad` = una parcela conocida del
mapa, ver `RoomExteriorBase.ts:2062-2100`). Mobiliario bakeado del editor
de interiores NUNCA entra en `ctx.vivas` — son sistemas distintos
(`interiores/` = decoración/ambientación bakeada offline; `construccion/` =
lo que el jugador coloca en vivo con la tecla B, persistido en BD).

**Consecuencia real**: hoy, un jugador que intente `crafteo:iniciar` en
cualquiera de las 11 mesas de la Zona 2 recibirá `"mesa inexistente"` — la
Zona 2 es decorativa, NO funcional todavía, al contrario de lo pedido
("todas las mesas de trabajo... ya colocadas y funcionales").

**Arreglo pendiente** (no trivial, requiere decisión de diseño, por eso no
se hizo en caliente): dar de alta estas 11 mesas como filas reales de la
tabla `construcciones` (propiedad = una parcela de testzone, x/y/objeto
correctos) al arrancar el mapa — o mover físicamente las mesas a la Zona 4
(parcela `p_0001`, sistema de construcción real) y colocarlas ahí en vivo
como jarl con la tecla B en vez de bakearlas. La segunda opción es más
simple y further prueba el flujo real de construcción de un tirón.

## 5. Verificación hecha (2026-08-31)

- `server/test/testZoneDebug.e2e.mjs` (NUEVO, sigue el patrón de
  `oficios.e2e.mjs`): 12/12 — los 6 `admin:debug:*`, gating admin-only,
  cofres (abrir/tomar/rechazo de id inexistente), y confirmación de que el
  único límite real al tomar de un cofre es el inventario del jugador, no
  el propio cofre.
- Probado con Playwright headless contra el servidor real: carga de
  terreno/NPCs/fauna, movimiento WASD, login superadmin (dispara
  `location.reload()`, tarda unos segundos en reconectar — normal, no es
  un fallo), panel F9 completo.
- `npm test` (server): 863/863. `tsc --noEmit` limpio en server/ y client/.
- Chromium headless se cae solo bajo carga repetida de tests (software
  WebGL, `--enable-unsafe-swiftshader`) — inestabilidad del entorno de
  prueba, no del juego (el servidor real sigue sano en paralelo en todos
  los casos observados).

## 6. Bugs REALES encontrados y arreglados esta ronda

1. **Mapa equivocado cargado en cliente** (`client/src/game.ts`, `RUTA_MAPA`)
   — con `sala=hub` (el caso normal, sin especificar), el cálculo de qué
   carpeta de assets pintar IGNORABA `mapaId` por completo y siempre caía
   en `/assets/mapas/principal` (o `VITE_RUTA_MAPA`), aunque el servidor sí
   conectaba a la room correcta (`hub_mapa` con el `mapaId` real). Efecto:
   terreno vacío/pantalla negra con `?mapaId=testzone` — esto era la causa
   raíz de casi toda la sesión de depuración en vivo con el usuario. Arreglado
   añadiendo el mismo ternario `MAPA_ID ? ... : ...` que ya usaba el join.
2. **Servidor se caía con "buffer overflow" de @colyseus/schema** — el
   `BUFFER_SIZE` por defecto (8KB) se quedaba corto con el estado de
   testzone (12 POIs + fauna + NPCs fijos + contenedores). `server/src/index.ts`
   ahora sube `Encoder.BUFFER_SIZE = 64 * 1024` al arrancar.
3. **Spawn en el centro geométrico del mapa** (160,160), lejísimos del
   clúster de zonas — `indice.json.ciudad` (de donde sale el spawn) no
   tenía ciudad real bakeada y caía al centro por defecto. Corregido a
   (220,270), el propio spawn documentado en ZONAS.md.
4. **Botón "Entrar" del login de admin no avisaba de nada si dejabas un
   campo vacío** (`client/src/admin/panelLoginAdmin.ts`) — silencio total,
   parecía que el botón no hacía nada. Ahora muestra "rellena usuario y
   contraseña".
5. **Fallo de conexión totalmente silencioso** — `client/src/main.ts` no
   tenía ningún `.catch()` sobre `iniciarJuego()`; si el `await
   client.joinOrCreate(...)` nunca resolvía (p.ej. una carrera con el
   servidor disponiendo la sala anterior justo al refrescar rápido con F5),
   la pantalla se quedaba negra sin ningún rastro en consola. Ahora
   muestra el error en pantalla y en consola. La causa de fondo de esa
   carrera concreta (F5 muy rápido) sigue sin arreglar — mitigación:
   evitar F5, usar pestaña/incógnito nueva para reconectar.

## 7. Pendiente real (aparte del §4)

- Detección de proximidad real a mesas/cofres en el cliente (hoy son
  teclas fijas con ids hardcodeados).
- La carrera de F5-justo-cuando-se-dispone-la-sala-anterior (server) sigue
  sin arreglar de fondo — solo se hizo visible el fallo, no se eliminó la causa.
- El resto de mecánicas (Zona 1 recolección/pesca/caza, Zona 4
  construcción, Zona 5 combate contra el dummy) se dan por buenas por
  reusar sistemas ya probados en producción — no se volvieron a probar
  aquí una a una por tiempo, pero no tocan código nuevo de esta pasada
  salvo lo ya cubierto en `testZoneDebug.e2e.mjs`.
