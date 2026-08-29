# GDD — Personaje: vitales y atributos (esqueleto)

**ESTADO: APLICADA (2026-08-29), verificada.** Primer esqueleto del "Sistema de personaje" que `docs/Backlog_Mecanicas_Futuras.md` dejaba con la lista de estadísticas ya dada por el streamer pero sin fórmulas/persistencia cerradas. Explícitamente pactado como ESQUELETO: se afina cada pieza más adelante (mismo patrón que el bakeador de animales — arrancar con la máquina completa y pocas especies, crecer después) — login/UI son las últimas piezas del proyecto y no se tocan aquí.

**Aplicado**: `VitalesSchema`/`AtributosSchema` en `Player` (`server/src/rooms/schema/HubState.ts`); lógica pura en `server/src/personaje/vitales.ts` (`tickVitales`, `restaurarVital`) y `server/src/personaje/atributos.ts`; curva de nivel por XP MOVIDA a `server/src/progresion/nivel.ts` (compartida con oficios, re-exportada desde `crafteo.ts` para no romper nada); tabla `jugador_atributos` (SQLite+Postgres, mismo patrón que `jugador_oficios`) + `obtenerXpAtributo`/`sumarXpAtributo` en `IAlmacenDatos`; tick de vitales enganchado al loop de movimiento YA existente (`RoomExteriorBase.actualizarMovimiento`, 30hz, sin tick nuevo); mensaje `personaje:consumir`; dos consumibles reales en el catálogo (`racion_viaje`→comida, `jarra_agua`→bebida); dos disparadores reales de XP de atributo (`gremio:fundar`→liderazgo, `npc:hablar`→carisma). Verificado: 11 tests puros nuevos (vitales.test.ts, atributos.test.ts), 306/306 tests de servidor, `tsc` limpio en server y client, y E2E manual con servidor real — vitales llegan al cliente ya decayendo en tiempo real desde el primer tick, rechazo correcto de `personaje:consumir` sin ítem, y `gremio:fundar` otorga 30 XP de liderazgo persistida de verdad en `jugador_atributos` — 7/7 comprobaciones OK.

## 0. Lista de partida (pedido literal del streamer, Backlog "Sistema de personaje")

**Vitales**: Vida, Comida, Bebida, Sueño, Estamina, Defensa física, Defensa mágica, Ataque físico, Ataque mágico — "todas modificables por consumibles, objetos, armaduras y armas".

**Atributos**: fuerza, inteligencia, destreza, sigilo, carisma, liderazgo — "mejoran según uso/experiencia, no un nivel global — encaja con el patrón ya usado en oficios".

## 1. Qué entra en este esqueleto y qué no

Solo los 5 vitales de "simulación de vida" (vida/comida/bebida/sueño/estamina) y los 6 atributos. Ataque/Defensa física y mágica NO se añaden como campos en `Player` — ya existen como stats del ARMA/ARMADURA equipada en `items/catalogo/items.json` (`ataqueFisico`/`defensaFisica`/...), documentados desde su alta como reservados para `docs/GDD_Combate.md` (propuesta ya escrita, esperando confirmación). Duplicar esos números en el Schema del jugador antes de que Combate esté aprobado sería inventar un segundo sitio para el mismo dato — cuando Combate se implemente, calculará el ataque/defensa efectivos combinando `atributos` (este documento) + equipo (`items.json`, ya existente) en el momento de resolver un golpe, sin nada que sincronizar de más.

## 2. Vitales — decaimiento en horas REALES, sin tick nuevo

`server/src/personaje/vitales.ts` es lógica PURA: `tickVitales(vitales, horasTranscurridas)` es un integrador simple (resta/suma directamente, sin checkpoint ni timestamp) que se llama una vez por jugador dentro de `RoomExteriorBase.actualizarMovimiento()` — el mismo tick de 30hz que YA existe para mover jugadores y separar colisiones (`separarPJs`), así que añadir vitales no es un tick nuevo, es una línea más en uno que ya corría.

- **Comida/Bebida/Sueño**: decaen solos en horas reales (PLACEHOLDER: vacían en 16h/10h/20h respectivamente — mismo criterio de "número de referencia, no decisión cerrada" que `pesoMaximoTransportable`).
- **Estamina**: al revés — nada la gasta todavía (sin sprint, sin combate construidos), así que se regenera pasivamente hasta el máximo; el día que exista un gasto real (correr, golpear), solo hay que restarle en el sitio que lo dispare, `tickVitales` no cambia.
- **Vida**: no decae sola. Si Comida, Bebida o Sueño llegan a 0, Vida empieza a drenar (2/hora por cada vital en 0 simultáneo — se suman) — es la única "penalización por vitales a 0" de este esqueleto, y se detiene sola en el propio 0 de Vida: qué pasa exactamente ahí (morir de verdad, dónde reaparece, qué se pierde) es `docs/Backlog_Mecanicas_Futuras.md` "Muerte y respawn — sin diseñar", explícitamente FUERA de este documento.

**Sin persistencia entre sesiones** — decisión deliberada, no un olvido: el inventario ya sentó el precedente de "vive y muere con la sesión" (`docs/GDD_Inventario.md`) mientras el login siga siendo un nombre libre sin cuenta real (`docs/Backlog_Mecanicas_Futuras.md`, "identidad v1 = nombre, hasta que haya login real"). Guardar un reloj de hambre entre reconexiones sin una identidad de verdad detrás no resuelve nada que no resuelva mejor el login cuando llegue — se revisita entonces, junto con la UI (ambos "lo último", pedido explícito del streamer).

## 3. Atributos — mismo mecanismo EXACTO que oficios

"Mejoran según uso, no un nivel global" ya tenía patrón hecho: XP por atributo, nivel SIEMPRE derivado (nunca persistido en sí). Tan literal que la curva de nivel (`UMBRALES_NIVEL`/`nivelDeXp`) se movió de `crafteo.ts` a `server/src/progresion/nivel.ts` para que oficios y atributos compartan la misma fuente en vez de dos copias idénticas — `crafteo.ts` re-exporta `nivelDeXp` tal cual, cero import roto.

Tabla `jugador_atributos` — copia 1:1 de `jugador_oficios` (jugador_id, atributo, xp):

```sql
CREATE TABLE IF NOT EXISTS jugador_atributos (
  jugador_id INTEGER NOT NULL,
  atributo TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (jugador_id, atributo)
);
```

`player.atributos.<nombre>` (Schema replicado, nivel ya derivado) se rellena OPORTUNISTAMENTE — solo cuando ese atributo concreto se toca en la sesión, mismo límite ya aceptado para `gremioId`/`gremioNombre` ("no hay onJoin async todavía"): el que no se ha tocado se queda en nivel 1 hasta que su disparador dispare.

**v1 solo conecta 2 disparadores reales**, mismo criterio que Crafteo arrancó con una receta representativa por familia en vez del árbol entero:

- **Liderazgo** ← `gremio:fundar` (30 XP) — fundar un gremio es la acción de liderazgo menos ambigua que ya existe.
- **Carisma** ← `npc:hablar` (5 XP, solo en respuesta con éxito) — ya limitado por el cooldown de 3s existente (cuota de Gemini/Groq), así que no hace falta un límite propio para la XP.
- **Fuerza, Destreza, Inteligencia, Sigilo**: se quedan en nivel 1 por defecto, SIN disparador todavía — dependen de sistemas que no están construidos (esfuerzo físico sostenido, combate, crafteo con tiradas, sigilo). El único consumidor real que YA tenía Fuerza (`pesoMaximoTransportable(fuerza)`, placeholder desde `docs/GDD_Inventario.md`) por fin recibe un valor real en vez de quedarse sin usar — sigue siendo el mismo placeholder de fórmula, ahora con un atributo de verdad detrás.

## 4. Consumir — primer uso real de `tipo:"consumible"`

`personaje:consumir {instanciaId}` (`RoomExteriorBase.manejarPersonajeConsumir`): exige que el ítem en el cuerpo del jugador sea `tipo:"consumible"` con un campo `restaura` en el catálogo (`{vital, cantidad}`) — sin `restaura`, se rechaza en vez de desaparecer sin efecto (un consumible de contenido futuro no debe comportarse como uno real a medias). Mismo `quitarItem`/`sincronizarContenedor` que ya usa `manejarSoltar`, cero mecanismo nuevo de inventario.

Dos consumibles reales de partida (aditivo en `items/catalogo/items.json`): `racion_viaje` (ya existía, ahora con `restaura: comida+40`) y `jarra_agua` (pasa de `tipo:"objeto"` a `tipo:"consumible"`, `restaura: bebida+40` — `tipo` no tenía consumidor real hasta ahora, cambiarlo es seguro).

## 5. Verificación

- `server/test/vitales.test.ts` (8) y `server/test/atributos.test.ts` (3): decaimiento por hora real, clamp en 0 y en el máximo, drenaje de vida proporcional al número de vitales en 0 simultáneos, `restaurarVital` respeta `vidaMax` si difiere de `VITAL_MAX`, curva de nivel compartida.
- Suite completa de servidor: 306/306 (era 295/295 antes de este documento). `tsc` limpio en server y client.
- E2E manual (`server` real, Colyseus + SQLite, dos fases con reinicio de servidor): `player.vitales`/`player.atributos` replican al cliente desde el primer tick (vitales YA decayendo fracciones de segundo reales, prueba de que el enganche al loop de movimiento está vivo); `personaje:consumir` rechaza una instancia inexistente; `gremio:fundar` otorga 30 XP de liderazgo que sobrevive en `jugador_atributos` tras reabrir la conexión — 7/7 comprobaciones OK.
- No se verificó en vivo el disparador de carisma (`npc:hablar`) porque requiere `GEMINI_API_KEY`/`GROQ_API_KEY` configuradas (no disponibles en este entorno) — el camino de éxito que otorga la XP está revisado por código y usa el mismo helper (`otorgarXpAtributo`) ya probado end-to-end por el disparador de liderazgo.

## 6. Fuera de alcance de este esqueleto (pendiente, se afina después)

- Fórmulas de bonus de Destreza/Inteligencia/Sigilo/Carisma más allá de `pesoMaximoTransportable(fuerza)` — a definir cuando exista quien las consuma (Combate, sigilo...).
- Slots de equipo de armadura (cabeza/torso/piernas/brazos sobre los pivotes de `rigHumanoide.ts`) — hoy `slotEquipo` solo tiene `cinturon`/`espalda`/`manoPrincipal`/`manoSecundaria` declarados; añadir armadura es catálogo puro cuando toque, el mecanismo (`puedeEquiparEnSlot`) ya es genérico y no necesita cambios de código.
- Morir de verdad, respawn, qué se pierde — `docs/Backlog_Mecanicas_Futuras.md` "Muerte y respawn", explícitamente aparte.
- Persistencia de vitales entre sesiones — ligada a que exista login real (ver §2).
- UI de personaje (barras de vitales, panel de atributos) — "lo último", pedido explícito del streamer, junto con el resto de interfaces.
