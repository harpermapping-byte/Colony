# Motor 3D de props/objetos/personajes — decisión y estado

Documento de referencia para no perder ni repetir esta decisión. **Léelo antes de tocar el render del cliente o de crear un catálogo/carpeta de assets nueva.**

## Decisión (confirmada con el streamer)

El juego es 2.5D estilo Project Zomboid. En vez de dibujar sprites por dirección (izquierda/derecha/arriba/abajo) de cada personaje/mueble/árbol/planta/roca/animal, **todo eso pasa a ser un modelo 3D real de vóxeles**, cargado en una escena con cámara ortográfica isométrica — la geometría gira de verdad, no hace falta un sprite por ángulo.

**Qué se queda en 2D a propósito**: el suelo/terreno (`assets/terrenos/`, tileset de texturas) y el mapa en sí. Nunca pasa a vóxel.

**Qué pasa a 3D**: props/decoración de exteriores (árboles, plantas, rocas), fauna, mobiliario/objetos de interiores, personajes (jugadores/NPCs), y en el futuro armas — cualquier cosa que no sea el fondo/mapa.

## Cómo se generan los modelos

Con el taller de vóxeles (generador de props vía IA, ver conversación — vive fuera de este repo) exportas un `.glb` por pieza. Lo guardas en el sitio que le toca según la convención de abajo y el motor lo recoge solo, sin tocar código.

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

## Qué falta (pendiente, no bloquea lo anterior)

- **Conectar el consumo real de los bakeadores**: hoy el cliente solo dibuja jugadores (lo único que ya sincronizaba el servidor). Falta leer `baker/output/<mapa>/sector_XXX_YYY.json` y el resultado de `interiores/src/colocarElementos.js`/`edificio.js` para instanciar de verdad árboles/rocas/mobiliario en sus posiciones bakeadas — hasta ahora ni la versión Phaser ni ninguna otra leía esto (confirmado en `assets/README.md`: "esta carpeta todavía no la lee ningún juego").
- **Terreno real**: el suelo es un plano gris placeholder; falta pintar el tileset de `assets/terrenos/` como textura del plano (o como grid de tiles), leyendo el string de terreno codificado de cada sector.
- **Personajes/animales animados**: el generador de vóxeles produce un bloque sólido, no un modelo con partes separadas — sirve tal cual para props estáticos (árboles, muebles, rocas), pero un personaje que camina/ataca necesita piezas separadas (torso/cabeza/brazos/piernas) con rig, que es un problema aparte. Mientras tanto, los personajes son un modelo 3D estático (o el placeholder cúbico).
- **Catálogo de personajes/armas**: no existe todavía ningún `catalogo/personajes.json` ni `catalogo/armas.json` en el repo (comprobado, no se ha creado ninguno para no inventar uno a medias) — se crea cuando toque esa fase, con el mismo patrón (`variantes`/`colorDebug`) que ya usan los demás catálogos.
- **Limpieza de PNG obsoletos**: decidir cuándo borrar los placeholders 2D de `assets/{vegetacion,animales,rocas}/` una vez tengan su `.glb` equivalente.
- **Instancing/rendimiento a escala de mundo**: `entityLoader` ya cachea la plantilla por URL, pero para cientos de árboles/rocas por sector (como ya genera el bakeador) conviene pasar a `InstancedMesh` por tipo en vez de un `clone()` por objeto — pendiente de medir cuando se conecte el consumo real de sectores.
