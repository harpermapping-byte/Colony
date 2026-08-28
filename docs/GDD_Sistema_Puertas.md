# Sistema de puertas — instancias exterior↔exterior e interior (v1)

Cómo un jugador cruza de una instancia a otra: del Hub a una aldea/POI, de esa aldea al interior de un edificio, y vuelta. Léelo antes de tocar `server/src/rooms/`, `server/src/mundo/mapaColision.ts`/`interiorColision.ts`, o `client/src/game.ts`.

## Decisión (confirmada con el streamer, 2026-08-28)

- **Activación: tecla de interacción (F)**, no automático al pisar — evita cruces accidentales al pasar cerca de una puerta.
- **Cambio de sala = recarga de página con otros parámetros de URL.** Más simple y robusto que reconstruir la escena de Three.js/el streaming de sectores en caliente; el coste es un parpadeo de carga en cada cruce. Una transición sin recarga (loading screen propio) es una mejora futura, no v1.
- **Una instancia por `mapaId` (regiones) o por `mapaId`+`edificio` (interiores)**: Colyseus `filterBy` hace que dos jugadores que entran al MISMO sitio caigan en la MISMA room; otro sitio es otra room — el "tope de jugadores" de las instancias es simplemente `maxClients` de esa room (40, heredado del Hub).

## Arquitectura

### Datos: `portales` en el `indice.json` bakeado

`ciudades/src/generar.js` ya escribía un array `portales` (sin consumir hasta ahora): `{tipo:"exterior"|"interior", x, y, edificio?, tipoEdificioId?}`. Se amplió el TIPO (no el bakeador) con un campo opcional `destino: {tipo:"region"|"hub", mapaId?}` para portales "exterior" de un mapa PADRE (hoy solo se usa a mano en mapas de prueba — ver "Qué falta"): sin `destino`, un portal "exterior" es la salida propia de ESE mapa hacia quien entró ahí.

### Servidor: tres tipos de room, una base compartida

- `server/src/rooms/base/RoomExteriorBase.ts` — extrae el movimiento/colisión/nadar-bucear/empuje-PJ que antes vivía solo en `HubRoom` (idéntico comportamiento, cero cambio de física) a una clase base reusable por cualquier room que juegue sobre una rejilla (`MundoColision`, ya genérica). Cada subclase carga SU rejilla y llama a `iniciarMovimiento()`.
- `HubRoom` (`"hub"`, singleton) — extiende la base, añade construcción/parcelas/jarl (sin cambios) y el manejador `"portal:usar"` para sus propios portales.
- `RegionRoom` (`"region"`, `filterBy(["mapaId"])`) — una aldea/POI bakeado por `ciudades/`: MISMO formato de mapa/colisión que el Hub, SIN construcción/parcelas/jarl (v1: las regiones de `ciudades/` no son terreno de jugadores todavía). `onCreate(options.mapaId)` resuelve la carpeta vía `mundo/resolverMapa.ts` (`assets/mapas/<mapaId>/`).
- `InteriorRoom` (`"interior"`, `filterBy(["mapaId","edificio"])`) — el interior YA bakeado de un edificio (`<mapaId>/interiores/<edificio>.json`, el mismo JSON que `interiores/src/edificio.js` genera). `mundo/interiorColision.ts` lo convierte a una rejilla `MundoColision`: cada sala de la PLANTA BAJA se marca pisable, y sus muebles con `colision:true` (mismo catálogo que ya usa `construccion/catalogo.ts` para las construcciones de jugador) endurecen sus casillas.
- Radio de interacción de un portal: 2.2 casillas (probado con Playwright que 1.5 se quedaba corto en la práctica — un jugador real casi nunca para exactamente sobre la casilla).

### Cliente: la URL decide la sala

`client/src/game.ts` lee `?sala=region|interior&mapaId=...&edificio=...&entradaX/Y=...&origenSala=...&puertaX/Y=...` (sin `sala` = Hub, comportamiento de siempre). Según `sala`:
- **hub/region**: streaming de sectores de siempre (mismo formato, solo cambia la ruta) — `region` sencillamente NO monta el constructor ni la demo de personajes.
- **interior**: se salta el streaming entero; hace `fetch` directo del JSON del interior (servible como estático, vive bajo `assets/mapas/<mapaId>/interiores/`) y lo pinta con `client/src/render3d/interiorVisual.ts` — placeholder de cajas de color por sala/mueble (mismo criterio "todo el arte es placeholder" del resto del proyecto), sin streaming ni paredes/techo todavía.
- Tecla **F** → `room.send("portal:usar")` (el servidor decide si hay puerta cerca, el cliente no calcula proximidad). La respuesta `"portal:ir"` construye la siguiente URL y hace `location.search = ...` (recarga). "Volver" desde un interior va a la región de la que colgaba (a la puerta exacta, con `entradaX/Y`) si `origenSala` era `"region"`, o al Hub si se entró directo desde ahí; "volver" desde una región siempre va al Hub (v1: sin pila de más de un nivel).

## Verificado

- Prueba manual con Playwright (`client/test/prueba_visual_puertas.cjs`, no forma parte de la suite): hub de prueba → puerta → aldea REAL bakeada (`ciudades/`) → puerta de una `casa_modesta` → **interior real con sus salas y muebles** → puerta → vuelta a la aldea justo en la puerta de la casa. Capturas en `client/test/capturas_puertas/` (gitignored, regenerable).
- Regresión de lo existente, ambos en verde tras el refactor de `HubRoom`: `client/test/streaming.e2e.cjs` (5/5, mapa principal real) y `client/test/construccion.e2e.cjs` (15/15 — construir, reiniciar servidor con la misma BD, interior de construcción de jugador intacto).
- `server` 32/32 tests, `tsc --noEmit` limpio en server y cliente.

## Qué falta (pendiente, no bloquea)

- **Integración con el mapa principal de producción**: hoy NINGÚN portal "exterior" del mapa principal (`assets/mapas/principal/`) tiene `destino` configurado — los 120 POIs no están enlazados a instancias todavía. Esto es trabajo de `baker/` (decidir cómo un POI del mapa grande referencia su `mapaId` de región) y una decisión del streamer, no algo que tocar sin permiso (CLAUDE.md). Se probó con un mapa de prueba (`assets/mapas/hub_test/`, copia del demo con un portal añadido a mano) — gitignored, no es parte del juego real.
- **Transición sin recarga de página**: la recarga es simple y robusta pero corta la música/el estado de UI. Un loading screen propio que reconstruya la escena en caliente es una mejora futura.
- **Interiores: solo planta baja**, sin paredes/techo (se ve la planta desde arriba), sin conectar `conectoresVerticales` (subir de piso). El punto de aparición es el centro de la PRIMERA sala del JSON, no necesariamente la que conecta con la puerta exterior real (no hay ese dato explícito en el bake todavía).
- **"Volver" es de un solo nivel**: interior→región→hub funciona porque el cliente guarda `origenSala`/`puertaX/Y` en la URL, pero no hay una pila general (hub→región A→región B→interior→... siempre vuelve al nivel inmediato conocido, nunca más atrás). Suficiente para el caso de uso actual (Hub → aldea → edificio), pero a revisar si se encadenan más niveles.
- **El nombre del jugador no sobrevive la recarga** salvo que se pase por `?nombre=`: cada cruce de puerta genera un `Viewer-NNN` nuevo si no se preserva el parámetro. Menor, pendiente de que exista login/sesión real.
