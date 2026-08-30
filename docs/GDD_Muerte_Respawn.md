# GDD — Muerte y respawn de jugador

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30).** Piezas: `server/src/personaje/respawn.ts` (nuevo, `resolverRespawn`), `server/src/rooms/base/RoomExteriorBase.ts` (`manejarMuerteJugador`/`procesarMuerteJugador`/`roomYPosicionParaDrop`, disparadores en `finalizarMuerte`/inanición/eventos ambientales), `server/src/rooms/ArenaCombateRoom.ts` (`roomYPosicionParaDrop` propio + no reenviar `volverDeCombate` a un caído), `server/src/inventario/desgaste.ts` (`aplicarPenalizacionMuerte`, ya existía pura y sin consumidor), `client/src/game.ts` (reenvía `entradaX/Y` en `portal:ir` tipo región). Probado: `server/test/respawn.test.ts` (5 tests nuevos), suite completa 453/453, `tsc --noEmit` limpio en `server/` y `client/`.

Pedido del streamer (2026-08-30): *"al morir pasa que respawneas en la cama de tu casa o propiedad y si no en el punto de spawn inicial, pierdes un 20% de durabilidad de todo tu equipo y pierdes el inventario (se queda en el cuerpo que se queda en donde moriste)"*.

## 1. Disparadores

`manejarMuerteJugador(sessionId)` es el único punto de entrada real — se llama desde **cualquier** camino que pueda dejar `vida <= 0`:

- Combate por turnos: `finalizarMuerte` (ya existía, antes solo hacía `vida = vidaMax`).
- Inanición/clima extremo y eventos Twitch de daño ambiental (rayo/terremoto): comprobados cada tick de `actualizarMovimiento`/`aplicarDanoEventosAmbientales`.

**Guardia de idempotencia** (`jugadoresMuriendo: Set<sessionId>`): imprescindible porque la función es `async` (espera a BD para el respawn) y `vida` no se resetea hasta el final — sin el guardia, el tick de 30hz que sigue viendo `vida<=0` durante la ventana async volvería a disparar todo el proceso (drop duplicado, respawn duplicado...) decenas de veces por segundo.

## 2. Qué pasa al morir (`procesarMuerteJugador`)

1. El contenedor `cuerpo` se separa en dos grupos según `tipo` del catálogo (`items/catalogo/items.json`): **"equipo"** (`herramienta`/`equipable`/`arma`) vs. **el resto**.
2. **Equipo**: `aplicarPenalizacionMuerte` (ya pura y testeada en `desgaste.ts`) le resta un 20% flat de durabilidad a cada pieza — se queda en el inventario del jugador.
3. **El resto**: cae al suelo como objetos sueltos normales (`ObjetoMundoSchema`, el MISMO mecanismo que "soltar" — recogible por cualquiera, él mismo incluido si vuelve a por ello). Sin cadáver ni ventana de looteo propia: se reusa el pipeline de "objeto en el mundo" ya en vivo, no el sistema de `CadaverFila` (BD-only, confirmado sin ningún consumidor en todo el proyecto).
4. Vida se repone a `vidaMax` y se resuelve el respawn (§3) antes de reenviar `portal:ir` al cliente muerto.

## 3. Dónde resucita (`personaje/respawn.ts::resolverRespawn`)

Busca, entre las **construcciones del propio jugador** (`bd.cargarPropiedades` + `bd.listarConstrucciones`, mismo par que ya usa el sistema de construcción del §GDD_Construccion.md), la primera con `catalogo[objeto].esCama === true` en una propiedad cuyo `dueno` coincide (insensible a mayúsculas). Si la encuentra, respawnea justo en esa casilla (`{tipo:"region", mapaId, x, y}`); si no —sin propiedad, sin cama construida, o la propiedad es de otro— cae al **Hub** (`{tipo:"hub"}`), el punto de spawn inicial.

Fuera de alcance explícito de esta v1 (documentado, no un olvido): una cama dentro de un inmueble COMPRADO pero sin decorar (sin construcción de jugador colocada) no cuenta — solo camas realmente construidas vía el sistema de parcelas.

## 4. Dónde caen los objetos (`roomYPosicionParaDrop`)

Por defecto, la posición real del propio jugador en SU room (Hub/Región/Interior: las coordenadas ya son las del mundo). `ArenaCombateRoom` lo sobreescribe porque sus coordenadas son internas a la instancia de combate: resuelve la room de ORIGEN vía `matchMaker.getLocalRoomById` (mismo mecanismo ya usado por `onCombateResuelto`) y usa `retorno.puertaX/puertaY` si el cliente los mandó; si no, cae en un (5,5) fijo — aproximado a propósito, sin más contexto de dónde entró el combatiente a la arena.

## 5. Decisiones a confirmar con el streamer

- No existe todavía un sistema de "equipar" en vivo (`SlotsEquipo` es un mapa sin ningún handler) — "equipo" se aproxima por `tipo` de ítem dentro del inventario normal. Cuando exista equipar de verdad, esto debe pasar a mirar los slots equipados.
- El fallback de posición de drop en arena ((5,5) sin `retorno.puertaX/Y`) es impreciso — aceptable para v1, pendiente de mejorar si se nota en juego.
