# Motor 3D de props/objetos/personajes — decisión y estado

Documento de referencia para no perder ni repetir esta decisión. **Léelo antes de tocar el render del cliente o de crear un catálogo/carpeta de assets nueva.**

## Decisión (confirmada con el streamer)

El juego es 2.5D estilo Project Zomboid. En vez de dibujar sprites por dirección (izquierda/derecha/arriba/abajo) de cada personaje/mueble/árbol/planta/roca/animal, **todo eso pasa a ser un modelo 3D real de vóxeles**, cargado en una escena con cámara ortográfica isométrica — la geometría gira de verdad, no hace falta un sprite por ángulo.

**Qué se queda en 2D a propósito**: el suelo/terreno (`assets/terrenos/`, tileset de texturas) y el mapa en sí. Nunca pasa a vóxel.

**Qué pasa a 3D**: props/decoración de exteriores (árboles, plantas, rocas), fauna, mobiliario/objetos de interiores, personajes (jugadores/NPCs), y en el futuro armas — cualquier cosa que no sea el fondo/mapa.

## Cómo se generan los modelos

Con el taller de vóxeles (`taller-vox/` — generadores de muebles y personajes + exportadores `.glb`, ver su README) exportas un `.glb` por pieza. Lo guardas en el sitio que le toca según la convención de abajo y el motor lo recoge solo, sin tocar código.

## Convención de assets — SIN catálogo nuevo

Importante: **no se creó ningún catálogo de datos nuevo**. Los catálogos que ya existían (`baker/catalogo/*.json`, `interiores/catalogo/elementos.json`) ya traían todo lo necesario — `variantes` (o `variantesNombradas`) y `colorDebug` — pensado en su día para placeholders 2D, y se reutiliza tal cual para 3D. Solo cambia la extensión de archivo que se busca.

```
assets/<categoria>/<id>_<NN>.glb        variante numerada (NN = 01, 02... según el campo "variantes" del catálogo)
assets/<categoria>/<variantId>.glb      variante con nombre propio (ej. variantesNombradas: "mesa_comedor_roble")
```

Mismo árbol de carpetas que ya documentaba `assets/README.md` para los PNG (`vegetacion/`, `animales/`, `rocas/`) — la única categoría nueva es `personajes/` (jugadores/NPCs, sin catálogo de datos propio todavía, ver pendientes) e `interiores/` (mobiliario/objetos de `interiores/catalogo/elementos.json`, que hasta ahora no tenía ninguna carpeta de assets).

**Placeholder mientras no existe el `.glb`**: un cubo de color usando el `colorDebug` que ya trae cada entrada del catálogo — no un campo nuevo, no una imagen nueva. Ver `client/src/render3d/placeholder.ts`.

Los PNG existentes en `assets/vegetacion/`, `assets/animales/`, `assets/rocas/` (placeholders 2D generados por `baker/src/generar_placeholders.js`) **quedan como referencia obsoleta** — el motor 3D nunca los lee. No se han borrado por si sirven de referencia visual al generar los `.glb` equivalentes; se pueden limpiar más adelante cuando cada categoría tenga ya su `.glb`.

## Qué se implementó ya (motor base, `client/`)

- Cliente migrado de **Phaser 3 (sprites 2D) a Three.js** (`client/package.json`) — Phaser se ha quitado del todo, no coexisten los dos motores.
- `client/src/render3d/worldScene.ts` — escena con cámara ortográfica isométrica, luces, suelo placeholder plano, y una cámara que sigue al jugador local (`seguirPunto`).
- `client/src/render3d/assetCatalog.ts` — resuelve `categoria + id + variante → URL del .glb` siguiendo la convención de arriba.
- `client/src/render3d/entityLoader.ts` — carga el `.glb` con `GLTFLoader`, cachea la plantilla por URL, y si falla (404, todavía no generado) cae a un cubo `colorDebug` sin romper nada. Cada instancia nueva es un `.clone()` de la plantilla ya cargada, no una carga de red por instancia.
- `client/src/render3d/placeholder.ts` — el cubo de color, anclado por la base (mismo criterio de anclaje que el resto del proyecto).
- `client/src/game.ts` — sustituye a la antigua `MainScene` de Phaser: misma lógica de red con Colyseus (sala `hub`, mensaje `"input"` con `{x,y}`), ahora dibuja cada jugador como entidad 3D en vez de sprite.
- `client/vite.config.ts` — sirve `assets/` (que vive en la raíz del repo, no dentro de `client/`) en `/assets` tanto en desarrollo como en el build de producción (`dist/assets/`), sin depender de ningún paquete nuevo. El bundle propio de Vite se mueve a `dist/_bundle/` para no mezclarse ni pisarse con la copia de `assets/`.
- Probado de punta a punta con un servidor+cliente reales corriendo: el jugador aparece como cubo 3D con volumen, gira la cámara isométrica correctamente, la etiqueta de nombre funciona, y el fallback a placeholder ante un `.glb` inexistente no rompe nada (solo un 404 esperado en consola).

## Segunda pasada (consumo de bakeados + rig animado, sobre la base anterior)

- **Consumo real del bakeador de exteriores** — el cliente carga un mapa bakeado y materializa EXACTAMENTE lo que dice, sin decidir nada nuevo (misma filosofía "generar una vez"):
  - `client/src/mapa/formatoMapa.ts` — tipos + decodificación del formato de `baker/src/exportar.js` (que sigue siendo la única fuente de verdad del formato; si cambia allí, este es el ÚNICO archivo del cliente a tocar). Terreno: un carácter base36 por casilla → índice en `leyendaTerreno` del `indice.json`.
  - `client/src/mapa/cargarMapa.ts` — fetch de `indice.json` + todos los `sector_XXX_YYY.json`. Para el mapa demo se cargan todos de golpe; la interfaz ya permite carga perezosa por cercanía cuando llegue el mapa grande (cada sector es un fetch independiente).
  - `client/src/render3d/terreno.ts` — el suelo real: UNA textura-canvas con 1 píxel por casilla (`NearestFilter` → tiles nítidos) pintada con el `colorDebug` de `baker/catalogo/terrenos.json`; un plano, un draw call. Cuando exista el tileset de arte, se pinta con esos tiles en esta misma textura sin tocar nada más.
  - `client/src/render3d/propsBakeados.ts` — vegetación/rocas/fauna del bake instanciadas en sus casillas con su rotación/escala/variante. **Instancing real**: agrupadas por especie, y cada especie sin `.glb` se pinta con UN `InstancedMesh` (una llamada de dibujado por especie, iguales 3 que 3.000 árboles). Si la especie ya tiene `.glb`, sus instancias son clones de la plantilla cacheada.
  - `client/src/render3d/catalogoVisual.ts` — colores y dimensiones de placeholder consultando los catálogos REALES del bakeador (importa `baker/catalogo/*.json` al bundle) — cero tablas duplicadas a mano; magenta = id sin entrada de catálogo, para que un descuadre cante a la vista.
  - **Mapa demo commiteado en `assets/mapas/demo/`** (48x48, pradera+bosque, 32KB) — bakeado con el bakeador real (`baker/src/index.js`), así el cliente arranca enseñando mundo de verdad sin pasos manuales. Los mapas grandes siguen en `baker/output/` (gitignored) como siempre.
- **Rig humanoide animado** (`client/src/render3d/rigHumanoide.ts`) — personajes con esqueleto básico estilo Roblox/Minecraft: 6 piezas (cabeza, torso, brazo izq/der, pierna izq/der) colgando cada una de su pivote (cuello/hombros/caderas); animar = rotar pivotes. Ciclo de andar (zancada con brazos en contrafase, rebote sutil) y respiración en parado, con rampa de mezcla para no cortar en seco. El personaje encara la dirección de movimiento. **La cara es geometría, no textura**: ojos y nariz como piezas propias sobre la cara frontal — legible en isométrico y preparado para que el futuro creador de personajes varíe cada rasgo por separado. La futura ropa/pelo/accesorios se cuelga del pivote de la parte del cuerpo que le toque y hereda las animaciones gratis. Cuando exista el modelo vóxel real de personaje, mantiene esta MISMA estructura de pivotes y solo cambia la geometría de cada pieza.
- **Interpolación de red** (`client/src/game.ts`) — los patches del servidor llegan 15 veces/seg (decisión de plan gratuito); dibujar cada patch tal cual daba movimiento a saltos. Ahora cada jugador dibujado PERSIGUE su posición de servidor (lerp exponencial por frame), la animación de andar se activa por movimiento real, y la cámara persigue igual de suave al jugador local (`WorldScene.actualizar(dt)`).
- **Bug arreglado en `entityLoader`**: el placeholder se cacheaba por URL con el color del PRIMER solicitante — todos los jugadores remotos salían del color del jugador local. Ahora el cache solo guarda plantillas `.glb` reales (o el `null` de "no existe"); el placeholder se construye por petición con el color/dimensiones de cada solicitante. Nueva API `obtenerPlantilla()` para quien necesite la plantilla compartida (instancing de props).
- Cliente a pantalla completa (el 800x600 fijo era herencia del canvas de Phaser); luz direccional con cámara de sombra abierta al mapa entero (la caja por defecto de ±5 unidades recortaba las sombras).
- Probado de punta a punta con servidor + DOS clientes reales (Playwright): terreno y props bakeados visibles en sus casillas, ambos jugadores como rigs animados con su color correcto (local naranja, remoto turquesa — el bug del cache habría pintado los dos de naranja), movimiento sincronizado entre pestañas y sin errores de consola más allá del 404 esperado de la sonda de `.glb`.

## Tercera pasada (personaje vóxel real como jugador + demo local)

- **El jugador ya es el personaje vóxel real** (`client/src/render3d/personajeVoxel.ts`): carga `assets/personajes/pj_01.glb` (exportado por `taller-vox/`, SkinnedMesh con 15 huesos y skinning rígido por vóxel) y lo anima rotando huesos — misma filosofía de pivotes y MISMA interfaz `RigHumanoide`, así que `game.ts` no distingue uno de otro. La túnica se retiñe por hueso (COLOR_0 de los vértices de spine/upperarm, con geometría clonada por instancia) para mantener naranja=local/turquesa=remoto. Si el `.glb` falta o falla, degrada al rig placeholder de cajas de siempre (`rigHumanoide.ts`, que se queda como fallback). Clonado de instancias con `SkeletonUtils.clone` (un `.clone()` normal comparte esqueleto y rompe la animación por jugador).
- **Mapa elegible por URL**: `?mapa=<nombre>` carga `assets/mapas/<nombre>/` sin tocar código (por defecto `demo`) — pensado para probar mapas bakeados nuevos recién commiteados.
- **Demo local de un jugador** (`client/src/demoLocal.ts`, se entra con `?demo=1`): mismo mundo bakeado y mismo personaje pero sin Colyseus — movimiento simulado en el cliente con la MISMA velocidad del servidor (4 px/tick × 30hz), spawn en el primer tile pisable en espiral desde la entrada de la ciudad (el punto exacto del mapa demo cae en un lago), y evento `demo-direccion` para cruceta táctil. Es lo que se publica como Artifact jugable (un único HTML con el bundle + mapa + .glb embebidos y un interceptor de fetch para servir los assets); también sirve para probar sin levantar el servidor.
- Probado de punta a punta con servidor + DOS clientes reales (Playwright): ambos jugadores como personajes vóxel con su color correcto, zancada al moverse y reposo al parar, sobre el mapa demo bakeado; y la demo local con su spawn en tierra firme. Sin errores de consola más allá del 404 esperado de la sonda de `.glb` de props.

## Qué falta (pendiente, no bloquea lo anterior)

- **Consumo de interiores**: leer el resultado de `interiores/src/edificio.js`/`colocarElementos.js` para instanciar mobiliario al entrar a una instancia interior — mismo patrón que `propsBakeados.ts` (agrupar por pieza, instanciar placeholder o clonar `.glb`), pendiente de decidir cómo viaja la instancia interior al cliente (¿por el servidor al entrar por la puerta?).
- **Carga perezosa de sectores + luz que sigue a la cámara**: para el mapa principal grande — el mapa demo cabe entero en memoria y en la cámara de sombra actual; uno de 100x100+ no.
- **Catálogo de personajes/armas**: sigue sin existir `catalogo/personajes.json` (a propósito) — cuando toque el creador de personajes, se crea con el mismo patrón (`variantes`/`colorDebug`) y el rig ya definido en `rigHumanoide.ts` como esqueleto base.
- **Fauna viva**: los objetos `t: "a"` del bake se pintan como marcadores estáticos de spawn; darles movimiento/IA es mecánica de servidor (fase futura), no del render.
- **Limpieza de PNG obsoletos**: decidir cuándo borrar los placeholders 2D de `assets/{vegetacion,animales,rocas}/` una vez tengan su `.glb` equivalente.
