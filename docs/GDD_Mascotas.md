# GDD — Mascotas (domesticar fauna urbana)

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30).** Piezas: `server/src/mundo/catalogoCombateFauna.ts` (+`domesticable`), `items/catalogo/items.json` (+`comidaMascota` en 8 ítems), `server/src/datos/bd.ts` (tabla `mascotas`, dual SQLite/Postgres), `server/src/rooms/schema/HubState.ts` (`Mascota`, `state.mascotas`), `server/src/rooms/base/RoomExteriorBase.ts` (seguimiento, `mascota:listar`/`llamar`/`dejarEnPropiedad`), `server/src/rooms/RegionRoom.ts` (`mascota:darComida`, domesticación), `server/src/mundo/fauna.ts` (`GestorFauna.quitar`), `client/src/mascotas/panelMascotas.ts` + `client/src/game.ts` (tecla G, panel placeholder, render). Probado: `server/test/catalogoCombateFauna.test.ts`, `server/test/fauna.test.ts`, `server/test/mascotasBd.test.ts` (nuevos, 7 tests), suite completa 374/374, `tsc --noEmit` limpio en `server/` y `client/`, `combate.e2e.mjs` sigue en verde (no toca mascotas, pero confirma que RoomExteriorBase no se rompió).

Pedido del streamer (2026-08-30): *"en las aldeas ciudades y ciudad capital salen spawnean animales perro y gato, si se les da de comer unas 5 veces, podrás convertirlo en tu seguidor, en tu mascota, pudiendo dejarla en alguna de tus propiedades o que te siga siempre, no hace ninguna acción de momento solo te sigue como mascota deja esto creado, si hace falta crear algún objeto hazlo"*.

## 1. Qué animales se pueden domesticar

Fauna URBANA (`baker/catalogo/animales.json`, `perro`/`gato`, ya tenían `domesticable: true` sin ningún consumidor) — SOLO existe en **RegionRoom** (aldeas/ciudades/capital, `server/src/mundo/fauna.ts:GestorFauna`), nunca en el Hub ni en fauna salvaje (`GestorFaunaSalvaje`, que no lee este campo). El catálogo de combate (`catalogoCombateFauna.ts`) ahora expone `domesticable` junto a `peligroso`/`vidaMaxima` — mismo campo, cero catálogo nuevo, "las listas crecen".

## 2. Dar de comer

`mascota:darComida` (sin payload, `RegionRoom`) — mismo criterio "sin UI de targeting" que `coger`/`portal:usar`: el servidor auto-apunta al animal domesticable más cercano dentro de `RADIO_INTERACCION`, y consume automáticamente el primer ítem del inventario marcado `comidaMascota: true` en `items/catalogo/items.json`. Ninguno existía marcado así: se añadió el campo a **las 4 carnes + los 3 pescados + `racion_viaje`** (8 ítems ya reales del catálogo, obtenidos cazando/pescando o llevados de viaje) — deliberadamente NO se creó un ítem nuevo "comida de mascota": el catálogo ya tenía comida de sobra y perro/gato son carnívoros por catálogo (`dieta: "carnivoro"`), darles carne/pescado es el fit natural.

Progreso en memoria por animal (`RegionRoom.progresoDomesticar`, vive y muere con la room — mismo criterio que `craftesEnCurso`/`inputs`): si un jugador DISTINTO empieza a darle de comer al mismo animal, el contador se reinicia a su nombre (evita que dos desconocidos se "repartan" sin querer la misma mascota). A la 5ª vez (`VECES_COMIDA_PARA_DOMESTICAR`), el animal desaparece de la fauna ambiental (`GestorFauna.quitar`) y nace como mascota.

## 3. Persistencia (`server/src/datos/bd.ts`)

Tabla nueva `mascotas` (dual SQLite/Postgres, mismo criterio que el resto del proyecto):

```sql
CREATE TABLE mascotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,  -- SERIAL en Postgres
  jugador_id INTEGER NOT NULL,
  especie_id TEXT NOT NULL,
  ubicacion TEXT NOT NULL DEFAULT 'siguiendo',  -- 'siguiendo' | 'propiedad'
  propiedad_id TEXT,
  creado_en TEXT NOT NULL
);
```

`crearMascota`/`listarMascotas`/`actualizarUbicacionMascota` en `IAlmacenDatos` — el último es todo-o-nada por `WHERE id=? AND jugador_id=?` (mismo patrón compare-and-swap que el resto de mutaciones de BD del proyecto): nunca deja tocar una mascota ajena aunque alguien adivine su id.

## 4. Seguir siempre / dejar en una propiedad

`ubicacion` decide si la mascota vive en el Schema replicado o no:

- **`"siguiendo"`** (nace así): `RoomExteriorBase` la mete en `state.mascotas` de LA ROOM DONDE ESTÉ SU DUEÑO — al entrar a cualquier room (Hub, aldea, interior...) se recargan sus mascotas "siguiendo" desde BD (`cargarMascotasSiguiendoDe`, sin awaitear, mismo criterio que el resto de efectos secundarios en segundo plano); al salir, desaparecen del Schema (nunca se persiste x/y, solo la fila en BD). Un tick a 5hz (`moverMascotas`) las mueve hacia un punto fijo alrededor del dueño (ángulo+distancia aleatorios por mascota, cosmético) — sin pathing, sin colisión, **sin acción propia** (pedido explícito: "no hace ninguna acción de momento, solo te sigue").
- **`"propiedad"`** (`mascota:dejarEnPropiedad {mascotaId, propiedadId}`): valida que `propiedadId` sea de verdad del jugador (`bd.obtenerPropiedad(id).dueno === nombre`, misma función que ya usa `docs/GDD_Propiedades.md`) y la saca del Schema — deja de seguir/renderizarse en cualquier room hasta que se la llame. **No se simula dentro del edificio** (los interiores se generan bajo demanda, sin entidades persistentes) — es "guardada", no "visible en su casa"; ver §6.
- **`mascota:llamar {mascotaId}`**: vuelve a `"siguiendo"` y reaparece junto al dueño en la room actual.

## 5. Cliente (placeholder de testeo)

Mismo criterio ya pactado con el streamer para combate ("que sean placeholder sencillas... al final del proyecto se hará toda la UI"): `client/src/mascotas/panelMascotas.ts` es texto+botones sin arte propio. Tecla **G** envía `mascota:darComida` sin comprobar nada en el cliente (el servidor decide si hay algo cerca y responde `mascota:progreso`/`mascota:domesticada`/`mascota:error`). El panel lista las mascotas del jugador (`mascota:listar` al conectar) con botón "Llamar" o "Dejar aquí" (pide el id de propiedad por `prompt()`, sin selector — no hay todavía un listado de "mis propiedades" en el cliente). Render: mismo circuito que la fauna doméstica (`crearAnimalVoxel`, fallback genérico por especie — una mascota no conserva el vóxel exacto de su spawn original en `fauna.json`, pierde esa referencia al domesticarse).

## 6. Fuera de alcance de esta pasada (pendiente, se afina después)

- **Ninguna acción propia** todavía (pedido explícito) — combate a favor del dueño, buscar objetos, montar, etc.
- **Dejar en propiedad no la hace visible dentro del edificio** — es un estado "guardada", no una entidad en el interior generado.
- **Solo perro/gato de partida** — el campo `domesticable` ya está listo para cualquier especie futura que se marque así en `baker/catalogo/animales.json`, sin tocar código (misma filosofía "las listas crecen, el código no").
- **Sin límite de mascotas por jugador** — no se pidió, no se impuso.
- **Cliente sin selector de propiedades** — hoy pide el id por `prompt()`; cuando exista un listado real de "mis propiedades" (pendiente en `docs/GDD_Propiedades.md`), se puede sustituir por un desplegable.
