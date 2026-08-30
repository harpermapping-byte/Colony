# GDD — Enfermedades: catarro y gripe

Pedido literal del streamer (2026-08-30): *"que con una herida tengas un 10% de que se infecte, si se infecta debes tomar unguentos que prepara el curandero para curarlo, una cantidad de 4 unguentos cuando te salgan los primeros sintomas [...] tu personaje tose, hace Cough cough [...] si no se cura tarda 1 semana ingame en pasarse el efecto y [...] tu vida baja hasta el 50% y no sube hasta que te lo quites aunque comas bebas o te curen [...] tambien en invierno existe un 10% de posibilidad de enfermar de gripe por el frio, se cura con jarabe para el catarro que hace el curandero, si no [...] tiuembles de frio y te muevas 50% mas lento hasta que te cures con el jarabe o pasen 1 semana de juego ingame. ya pondremos como avisa de que estas enfermo aparte de tosiendo y tal"*.

Este documento cierra el diseño concreto y es ahora el contrato — mismo criterio que el resto de GDD. **Aviso explícito del streamer**: cómo se avisa de estar enfermo, aparte de la tos, queda para más adelante — no está resuelto aquí a propósito.

## 0. Decisiones de arquitectura (por qué esto no toca `anatomia.ts` por dentro)

- **Módulo nuevo `server/src/personaje/enfermedades.ts`** (PURO, sin Colyseus/BD), hermano de `anatomia.ts`/`vitales.ts` — mismo patrón "toma/devuelve datos, quien llama decide". No se metió dentro de `anatomia.ts` porque el catarro es una condición **GLOBAL del jugador** (tose, vida con tope), no por zona — se cierra sobre `anatomia.ts` con dos helpers nuevos (`tieneAlgunaInfeccion`/`curarInfecciones`), sin tocar su lógica de golpe/venda/cirugía existente.
- **El 10% de catarro por herida es ADICIONAL, no sustituye** el 25% que ya existía en `usarVenda` (vendar sin ungüento, `docs/GDD_Anatomia.md`). Antes de esta fase, una herida NUNCA vendada no arriesgaba infección jamás (hueco real) — ahora cualquier herida sangrante tira este 10% en el momento del golpe, se vende luego o no. Las dos tiradas conviven: una herida puede infectarse por el golpe en sí Y, si además se venda sin ungüento, tiene otra tirada de 25% en ese momento.
- **"Catarro" es GLOBAL, no por zona**: se deriva de "¿hay alguna de las 6 zonas con `infectado:true`?" (`anatomia.ts::tieneAlgunaInfeccion`). Las 6 zonas siguen llevando su propio booleano `infectado` (panel médico, cirugía las cura las 6 de golpe); el reloj/cura/consecuencia del catarro (tose, tope de vida) vive en `EstadoEnfermedades`, una capa por encima.
- **"1 semana ingame" no existe como unidad** — todo vitales/anatomía corre en HORAS REALES (`vitales.ts` lo dice explícito: "Horas REALES, no tiempoMundo()"). Se deriva de `assets/mundo/tiempo.json` (`minutosRealesPorDia: 30`): 7 días de juego × 30 min reales = 210 min = **3.5 horas reales** (`HORAS_AUTOCURAR_ENFERMEDAD`).
- **El tope de vida del catarro es un TECHO, nunca un suelo**: "vida baja hasta el 50% y no sube" se traduce en `vida = min(vida, vidaMax*0.5)` cada tick, DESPUÉS de cualquier otro cambio de vida de ese mismo tick (comer/beber/curar no lo esquivan) — no impide que sangrado/inanición/combate la bajen más por debajo del 50%.
- **Gripe por frío es una tirada DE FLANCO**: solo se tira la PRIMERA vez que se pasa de "no frío" a "frío" (en invierno), nunca cada tick mientras se mantiene el frío — mismo criterio "un golpe, una tirada" que el resto de eventos discretos del proyecto (evita que exponerse al frío muchos ticks seguidos dispare la tirada decenas de veces).
- **Ungüento/jarabe son self-service, sin oficio** — igual que vendar/entablillar: el curandero los PREPARA (receta), tomárselos no exige mesa ni instrumental ni oficio.

## 1. Catarro (infección de herida)

- **Disparo**: cada golpe con `sangrado:true` (`resolverGolpeAnatomico`/`aplicarGolpe`, ver `docs/GDD_Anatomia.md`) tira `PROB_CATARRO_POR_HERIDA = 0.1` (`server/src/rooms/base/RoomExteriorBase.ts::aplicarEfectoAnatomicoSiCorresponde`); si acierta, esa zona queda `infectado:true` de inmediato.
- **Síntoma**: en cuanto hay alguna zona infectada, arranca el reloj de catarro (`iniciarCatarroSiCorresponde`, primer tick perezoso que lo detecta) y el jugador empieza a toser — burbuja de texto periódica "Cough cough..." sobre su cabeza (reusa `escena.textoEtiqueta`, `client/src/game.ts`, alternando con el nombre cada ~10s, ~3s de tos). Sin indicador adicional todavía (pedido explícito: "ya pondremos cómo avisa... aparte de tosiendo").
- **Efecto**: vida con TECHO al 50% de `vidaMax` mientras esté activo (`aplicarTopeVidaPorCatarro`, aplicado cada tick).
- **Cura A — ungüentos**: `medico:tomarUnguento` (self-service, sin oficio) consume 1 `unguento` del inventario propio y suma una dosis (`tomarUnguentoCatarro`); a la 4ª (`UNGUENTOS_PARA_CURAR_CATARRO`) se cura del todo — se limpia `infectado` en las 6 zonas (`anatomia.ts::curarInfecciones`).
- **Cura B — cirugía**: `operarCirugia` (oficio curandero) ya limpiaba `infectado` en las 6 zonas; con esta fase, limpiar esas zonas basta para que el catarro se cierre solo en el siguiente tick (`tieneAlgunaInfeccion` pasa a `false`, pero el RELOJ de catarro (`catarroDesde`) no lo limpia la cirugía directamente — queda "sin fiebre pero con el reloj corriendo" hasta que expire o se tomen los ungüentos). Aceptado como comportamiento de esta fase: cirugía cura las HERIDAS, no es el verbo pensado para el catarro (ese es el ungüento) — si se quiere que la cirugía también corte el reloj de golpe, es un cambio de una línea (`if (curado) { limpia catarroDesde también }`) para cuando el streamer lo pida.
- **Cura C — autocuración**: si no se cura, 1 semana ingame (3.5h reales) después se cierra solo (`resolverAutocuracionEnfermedades`), limpiando también `infectado` en las 6 zonas.

## 2. Gripe (frío de invierno)

- **Disparo**: cada vez que `aplicarTemperaturaCorporal` (`vitales.ts`) devuelve `"frio"` (temperatura corporal ≤25) Y la estación es `"invierno"` (`tiempoMundo()`/`clima.ts`) Y es un flanco nuevo (no estaba ya en frío el tick anterior), tira `PROB_GRIPE_POR_FRIO_INVIERNO = 0.1` (`rodarGripePorFrio`).
- **Síntoma**: burbuja de texto periódica "*tiritando*" (mismo mecanismo que la tos del catarro, alternando con el nombre).
- **Efecto**: -50% de velocidad de movimiento (`multiplicadorVelocidadPorGripe`, se combina multiplicando con fractura/crítico/montura, igual que el resto de multiplicadores ya existentes en `RoomExteriorBase.ts::actualizarMovimiento`).
- **Cura A — jarabe**: `medico:tomarJarabe` consume 1 `jarabe_catarro` y cura al instante (`tomarJarabeGripe`) — a diferencia del catarro, un solo jarabe basta (el streamer no pidió una cantidad para la gripe).
- **Cura B — autocuración**: 1 semana ingame (3.5h reales) sin curarse (`resolverAutocuracionEnfermedades`).

## 3. Ítems y recetas nuevas

- `unguento` (`items/catalogo/items.json`, ya existía para prevenir infección al vendar) gana un SEGUNDO uso: curar el catarro ya declarado, 4 dosis. Misma receta de siempre (curandero, `mortero_grande_boticario`, miel+fruta, N1).
- `jarabe_catarro` (NUEVO): consumible, cura la gripe al instante. Receta: curandero, `mortero_grande_boticario`, N2, `hierba_aromatica`×2 + `miel`×1. El nombre coloquial ("para el catarro") es el que usó el streamer — lo que cura mecánicamente es la GRIPE, no el catarro (ese lo cura el ungüento); queda anotado en el `_nota` del ítem para que no confunda a otro agente.

## 4. Persistencia y red

- `server/src/personaje/enfermedades.ts::EstadoEnfermedades { catarroDesde, unguentosTomados, gripeDesde, expuestoFrioPrevio }` — estado PURO completo (con timestamps), server-only, mismo patrón que `Anatomia`: `RoomExteriorBase.enfermedadesPorSesion: Map<sessionId, EstadoEnfermedades>` + `enfermedadesDe`/`mirrorEnfermedadesASchema`/`persistirEnfermedades`.
- `EnfermedadesSchema` (`HubState.ts`, `Player.enfermedades`): solo `catarro`/`gripe` (booleanos) + `unguentosTomados` (progreso 0-3 para pintar "2/4") — igual que `AnatomiaSchema`, los timestamps nunca cruzan la red.
- BD (`server/src/datos/bd.ts`): columna `enfermedades TEXT` (JSON), mismo patrón que `anatomia` — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` en SQLite y Postgres, `actualizarEnfermedadesJugador`. Se carga en `HubRoom.ts::onJoin` (best-effort, igual que anatomía/vida) y se persiste en eventos discretos (empieza/cura una enfermedad), nunca cada tick.
- Mensajes nuevos: `medico:tomarUnguento`/`medico:tomarJarabe` (self-service, sin `targetSessionId` — siempre sobre uno mismo) → responden `medico:unguentoTomado {unguentosTomados, curado}` / `medico:jarabeTomado {curado:true}`, o `medico:error` (mismo canal que vendar/entablillar/cirugía).

## 5. Cliente

- `client/src/personaje/panelMedico.ts` (placeholder de testeo, mismo criterio que el resto del panel): sección nueva bajo las 6 zonas — "🤧 Catarro (ungüentos: N/4)" + botón "Tomar ungüento" si `catarro:true`; "🥶 Gripe (-50% velocidad)" + botón "Tomar jarabe" si `gripe:true`.
- `client/src/game.ts`: burbuja de texto periódica sobre CUALQUIER jugador visible (local o remoto) con catarro/gripe, reusando `escena.textoEtiqueta` (el mismo mecanismo del pregón de NPCs) — alterna cada ~10s entre el síntoma (~3s: "Cough cough..."/"\*tiritando\*") y el nombre. `EstadoJugador` (interfaz compartida con NPCs/fauna/mascotas en la interpolación) gana `name?`/`catarro?`/`gripe?` opcionales — solo los jugadores reales los rellenan.

## 6. Verificación

- `server/test/enfermedades.test.ts` (18 tests): probabilidades tal cual pedidas, tirada de catarro respeta el rnd inyectado, el reloj de catarro arranca una sola vez, la tirada de gripe es de flanco (nunca cada tick en frío, nunca fuera de invierno, un nuevo flanco tras salir del frío puede volver a tirar), autocuración a 1 semana ingame ni un tick antes, 4 ungüentos exactos para curar (ni 3 ni 5), 1 jarabe cura la gripe al instante, el tope de vida es techo (baja si excede, nunca sube, no impide bajar más), el multiplicador de velocidad por gripe.
- `server/test/enfermedadesBd.test.ts` (2 tests): `enfermedades` arranca en `null`, se persiste y relee tal cual en JSON.
- `tsc --noEmit` limpio en `server/` y `client/`.

## 7. Huecos honestos que quedan

- **Cómo avisa de estar enfermo, aparte de toser/tiritar** — pedido EXPLÍCITAMENTE aplazado por el streamer ("ya pondremos"). Hoy solo hay la burbuja de texto periódica y el panel médico placeholder; no hay icono de estado persistente, ni sonido, ni aviso al conectar.
- **Cirugía no corta el reloj de catarro** — cura las heridas (limpia `infectado`) pero `catarroDesde` sigue corriendo hasta que se tomen los 4 ungüentos o pase la semana. Aceptado en esta fase (ver §1); es un cambio trivial si se pide luego.
- **Sin balance de "cuántas heridas sangrantes simultáneas son razonables"** — con `PROB_SANGRADO=0.2` y `PROB_CATARRO_POR_HERIDA=0.1`, un combate largo con muchos golpes cortantes/perforantes puede acumular varias zonas infectadas a la vez; el catarro sigue siendo UNA sola condición global (no se agrava por tener 3 zonas infectadas en vez de 1), solo cambia cuántas zonas hay que limpiar al curar.
- **La gripe no interactúa con la ropa/armadura** — no hay bonus de "abrigo" que reduzca la probabilidad todavía (`ropa/catalogo/prendas.json` no declara nada de aislamiento térmico); cualquier jugador en invierno con frío extremo corre el mismo 10%.
