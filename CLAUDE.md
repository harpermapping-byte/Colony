# CLAUDE.md — Streamer Colony

Guía para cualquier agente/sesión de Claude que trabaje en este repo. Léela entera antes de tocar nada: aquí está el estado real del proyecto y las reglas de trabajo acordadas con el usuario.

## Qué es este proyecto

MMO RPG medieval **instanciado** (Hub persistente + instancias con tope de jugadores: regiones exteriores, interiores, mazmorras), con integración de Twitch (chat, mecánicas para viewers) como meta futura. Todo diseñado para **infraestructura 100% gratuita**: un solo proceso de servidor en Render free con muchas rooms de Colyseus, cliente estático en Vercel. El usuario (el streamer) dirige el proyecto; suele haber **varios agentes trabajando en paralelo, cada uno en una zona** — ver "Reglas de trabajo".

## Mapa del repo (quién es cada carpeta)

- **`baker/`** — bakeador de mapas EXTERIORES (offline, sin dependencias): ruido Perlin propio, biomas por clima (latitud + altitud + ruido), hidrología real (priority-flood + flujo D8, meandros/lagos orgánicos), caminos A* con coste por pendiente y puentes sobre ríos, decoración con densidad regional, POIs, exportado por sectores/chunks. CLI: `node src/index.js config/<archivo>.json` · GUI: `node gui/servidor.js`. Diseño: `docs/GDD_Bakeador_Exteriores.md`.
- **`interiores/`** — bakeador de INTERIORES (edificios: 44 tipos, 39 tipos de sala, ~140 muebles con RoomTags/FurnitureConfig/variantes de material reales) + **editor web** (`node gui/servidor.js`, puerto 4100): genera edificios multi-planta, edición no destructiva (lo modificado a mano sobrevive regeneraciones), guardar/cargar a `output/*.json`, vista de habitación isométrica y **vista 3D girable del edificio entero** (`gui/vista3d.js`). Diseño: `docs/GDD_Bakeador_Interiores.md`. Tests: `node --test test/catalogo.test.js` (31) y `node test/editor.e2e.js` (11, Playwright).
- **`ropa/`** — generador procedural de ROPA (offline, sin dependencias, mismo patrón que `interiores/`): catálogo de prendas por oficio/tag (`ropa/catalogo/prendas.json` + `profesiones.json`, cruzando el vocabulario de oficios que ya usa `interiores/catalogo/tipos_edificio.json`), generación en vóxeles a partir de una prenda+material+semilla (`ropa/src/generarPrenda.js`), colgada del pivote del rig que le toque (torso/piernas/cabeza/brazos). Reusa `interiores/catalogo/materiales.json` (con las fibras de tela añadidas ahí: lino/lana/seda) y `client/src/render3d/proporcionesRig.json` (medidas del rig, fuente única compartida con `rigHumanoide.ts`) — cero catálogos duplicados. Vista de prueba: `node ropa/src/prueba_render_voxel.js` (SVG) + `node ropa/src/prueba_render_png.js` (PNG vía Playwright global). Diseño: `docs/GDD_Ropa_Procedural.md`.
- **`client/`** — cliente del juego: **Three.js** (NO Phaser — se migró), cámara ortográfica isométrica FIJA estilo Project Zomboid con modelos 3D reales debajo que sí rotan. Consume mapas bakeados (`assets/mapas/demo/`), instancia props por especie (`InstancedMesh`), rig humanoide animado por pivotes (cabeza/torso/brazos/piernas — la futura ropa se cuelga de esos mismos pivotes), interpolación de red. Leer **`docs/GDD_Motor_3D_Props.md` antes de tocar el render o crear carpetas de assets** — ahí están la convención `.glb` y los pendientes reales.
- **`server/`** — Colyseus (room `hub`, 30hz simulación / 15hz patches, input solo al cambiar dirección). Pensado para Render free. NO añadir polling ni trabajo de fondo.
- **`assets/`** — arte por convención de nombre = id de catálogo (`<categoria>/<id>_<NN>.png|.glb`). Placeholders regenerables con `baker/src/generar_placeholders.js` (solo crea los que faltan). `assets/mapas/demo/` es el mapa que carga el cliente hoy; `assets/mapas/principal/` es el MAPA PRINCIPAL exterior del juego (bakeado por el usuario: 100x100 chunks = 3200x3200 casillas, 120 POIs, ~735k props, 70MB) — el cliente NO puede cargarlo hasta implementar la carga perezosa de sectores (pendiente en `docs/GDD_Motor_3D_Props.md`); no rebakear ni tocar sin permiso del usuario.
- **`docs/`** — los GDD son la memoria del proyecto: TODA decisión de diseño se documenta ahí al implementarla, con el porqué. Si cambias comportamiento, actualiza el GDD correspondiente en el mismo commit.
- **`Secret`** (otro repo del usuario) — NO es de este proyecto; no tocarlo aunque la sesión se haya abierto desde él.

## Filosofía técnica (no negociable sin preguntar al usuario)

1. **Generar UNA vez, nunca en directo** — los bakeadores corren offline; el servidor en vivo solo lee. Cálculo perezoso para todo lo que cambia con el tiempo.
2. **Catálogo como fuente de verdad**: el bakeador coloca referencias por id, nunca datos "a fuego". Toda entrada nueva de catálogo lleva `uso` (para qué sirve). Los colores/dimensiones visuales salen de `colorDebug` del catálogo — no duplicar tablas.
3. **Determinismo por semilla**: misma semilla = mismo resultado, siempre (PRNG mulberry32 en `azar.js`/`ruido.js`). Nada de `Math.random()` en generación.
4. **Optimizado para gratis**: typed arrays en bucles calientes, claves numéricas (no strings) en Sets consultados por casilla, instancing en cliente, solo cuesta lo cercano a jugadores activos.
5. **Edición no destructiva** (interiores): `origen: "generado" | "modificado"` — regenerar NUNCA borra lo modificado a mano salvo `forzar: true`.
6. **El muro no ocupa casilla** (interiores): `ancho x largo` de una sala es suelo caminable real; la puerta cae una fila más allá del rectángulo.

## Reglas de trabajo con el usuario

- **Idioma: español** — código, comentarios, commits, docs y respuestas. Estilo de comentarios: explican el PORQUÉ y las decisiones, no parafrasean el código.
- **Varios agentes en paralelo, cada uno en su zona.** Antes de empezar: `git pull` y mira los últimos commits para ver qué han hecho los demás. Si otro agente ya empezó lo tuyo, completa sus pendientes documentados en vez de duplicar. Push a `main` directamente (no hay PRs); si el push falla por trabajo nuevo remoto, pull + merge y vuelve a subir.
- **Los bakes grandes/de producción los corre el usuario** — los agentes solo hacen bakes pequeños de prueba.
- **Probar antes de dar por hecho**: suites de interiores (31+11) en verde, bake de prueba verificado programática y visualmente (Playwright para GUI/cliente: `NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, chromium en `/opt/pw-browsers/chromium`). Los cambios de comportamiento se demuestran con números o capturas, no se afirman.
- **Cambios grandes de diseño**: proponer primero y esperar el OK del usuario; lo acordado se aplica entero sin volver a preguntar.
- El usuario escribe rápido y con erratas — interpretar la intención; si una instrucción es ambigua de verdad, preguntar corto y seguir.

## Estado actual (resumen — el detalle vive en los GDD)

- Exterior: pipeline completo y pulido (Perlin, clima coherente, ríos/lagos orgánicos, puentes, red de caminos ramificada, densidad regional, pools de spawn). ⚠️ El cambio a Perlin hizo que la misma semilla dé mapas distintos: los mapas antiguos deben rehornearse.
- Interiores: catálogo + motor + editor completos (RoomTags, fases Dominante→Secundario→Decoración, childSlots, variantes de material desde especies reales del baker, guardar/CARGAR, vista 3D girable). Falta de verdad: WFC para forma de sala, puertas/ventanas como instancia editable, que el editor lea/escriba configs.
- Cliente: motor 3D funcionando de punta a punta (mapa demo bakeado → terreno + props instanciados + jugadores con rig animado sincronizados por Colyseus). Falta: consumo de interiores al cruzar una puerta, carga perezosa de sectores para mapas grandes, catálogo de personajes/armas (el creador de personajes usará el rig de `rigHumanoide.ts` como esqueleto base).
- POIs (tercer tipo de mapa, aldeas/ciudades navegables): solo diseño (`GDD_Bakeador_POIs.md`), sin motor.
