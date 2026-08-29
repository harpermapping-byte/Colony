# GDD — Personaje: vitales y atributos (esqueleto)

**ESTADO: APLICADA (2026-08-29), verificada — curva de niveles, disparadores y bonus por nivel ampliados (2026-08-30, ver §3.1-3.3); lista de atributos final: fuerza, destreza, inteligencia, resistencia, carisma (sigilo retirado, comercio fusionado en carisma); sprint + Resistencia por tiempo de movimiento (§3.4) y actividades diarias de entrenamiento para Fuerza/Destreza/Inteligencia (§3.5), ambas 2026-08-30.** Primer esqueleto del "Sistema de personaje" que `docs/Backlog_Mecanicas_Futuras.md` dejaba con la lista de estadísticas ya dada por el streamer pero sin fórmulas/persistencia cerradas. Explícitamente pactado como ESQUELETO: se afina cada pieza más adelante (mismo patrón que el bakeador de animales — arrancar con la máquina completa y pocas especies, crecer después) — login/UI son las últimas piezas del proyecto y no se tocan aquí.

**Aplicado**: `VitalesSchema` (comida/bebida/sueño/estamina — SIN vida, ver §1) + `AtributosSchema` en `Player` (`server/src/rooms/schema/HubState.ts`); lógica pura en `server/src/personaje/vitales.ts` (`tickVitales`, `restaurarVital`) y `server/src/personaje/atributos.ts`; curva de nivel por XP MOVIDA a `server/src/progresion/nivel.ts` (compartida con oficios, re-exportada desde `crafteo.ts` para no romper nada); tabla `jugador_atributos` (SQLite+Postgres, mismo patrón que `jugador_oficios`) + `obtenerXpAtributo`/`sumarXpAtributo` en `IAlmacenDatos`; tick de vitales enganchado al loop de movimiento YA existente (`RoomExteriorBase.actualizarMovimiento`, 30hz, sin tick nuevo); mensaje `personaje:consumir` (cura `vida` vía `combate.ts:curar()` cuando toca, resto de vitales vía `restaurarVital`); dos consumibles reales en el catálogo (`racion_viaje`→comida, `jarra_agua`→bebida); dos disparadores reales de XP de atributo (`gremio:fundar`→liderazgo, `npc:hablar`→carisma). Reconciliado tras fusionar con `docs/GDD_Mecanicas.md §5.4` (combate interino, mismo día) — ver §1 para el detalle real de la colisión encontrada y cómo se resolvió. Verificado: 12 tests puros nuevos (vitales.test.ts, atributos.test.ts), 345/345 tests de servidor tras el merge, `tsc` limpio en server y client, y E2E manual con servidor real — vitales llegan al cliente ya decayendo en tiempo real desde el primer tick, rechazo correcto de `personaje:consumir` sin ítem, y `gremio:fundar` otorga 30 XP de liderazgo persistida de verdad en `jugador_atributos` — 7/7 comprobaciones OK.

## 0. Lista de partida (pedido literal del streamer, Backlog "Sistema de personaje")

**Vitales**: Vida, Comida, Bebida, Sueño, Estamina, Defensa física, Defensa mágica, Ataque físico, Ataque mágico — "todas modificables por consumibles, objetos, armaduras y armas".

**Atributos**: fuerza, inteligencia, destreza, sigilo, carisma, liderazgo — "mejoran según uso/experiencia, no un nivel global — encaja con el patrón ya usado en oficios".

## 1. Qué entra en este esqueleto y qué no

Solo 4 vitales de "simulación de vida" (comida/bebida/sueño/estamina) y los 6 atributos. Ataque/Defensa física y mágica NO se añaden como campos en `Player` — ya existen como stats del ARMA/ARMADURA equipada en `items/catalogo/items.json` (`ataqueFisico`/`defensaFisica`/...), documentados desde su alta como reservados para `docs/GDD_Combate.md`. Duplicar esos números en el Schema del jugador antes de que Combate esté aprobado sería inventar un segundo sitio para el mismo dato — cuando Combate se implemente, calculará el ataque/defensa efectivos combinando `atributos` (este documento) + equipo (`items.json`, ya existente) en el momento de resolver un golpe, sin nada que sincronizar de más.

**Vida NO vive aquí — colisión real encontrada y corregida al fusionar con Combate.** Esta pasada arrancó ANTES de que `docs/GDD_Mecanicas.md §5.4` (combate interino, mismo día) llegara a `main`: la primera versión de este documento sí incluía `vida`/`vidaMax` en `VitalesSchema`, con la vida drenando por tick si comida/bebida/sueño llegaban a 0. Al hacer `git pull`/merge apareció `Player.vida/vidaMax/ataque/defensa` ya construido y con una regla EXPLÍCITA marcada "no negociable sin volver a preguntar al streamer": *nadie se cura ni se hace daño solo con el paso del tiempo — curar/dañar es siempre un evento explícito* (por eso `combate.ts` no tiene ninguna función de tick). Mi drenaje por hambre violaba esa regla de raíz, y además duplicaba la fuente de HP. Solución: `vida`/`vidaMax` se quitan de `VitalesSchema` — `Player.vida/vidaMax` (de Combate) queda como ÚNICA fuente; el drenaje automático por hambre se elimina sin más (era, de todos modos, el hueco que este mismo documento §2 ya marcaba como límite con Muerte/Respawn — no se pierde alcance aprobado, se retira un mecanismo que nunca llegó a confirmarse). `personaje:consumir` sigue pudiendo curar vida cuando un consumible declare `restaura.vital:"vida"`: llama a la MISMA `curar()` pura de `combate.ts` sobre `player.vida` directamente — un evento explícito disparado por el jugador, no un tick, así que respeta la regla tal cual.

## 2. Vitales — decaimiento en horas REALES, sin tick nuevo

`server/src/personaje/vitales.ts` es lógica PURA: `tickVitales(vitales, horasTranscurridas)` es un integrador simple (resta/suma directamente, sin checkpoint ni timestamp) que se llama una vez por jugador dentro de `RoomExteriorBase.actualizarMovimiento()` — el mismo tick de 30hz que YA existe para mover jugadores y separar colisiones (`separarPJs`), así que añadir vitales no es un tick nuevo, es una línea más en uno que ya corría.

- **Comida/Bebida/Sueño**: decaen solos en horas reales (PLACEHOLDER: vacían en 16h/10h/20h respectivamente — mismo criterio de "número de referencia, no decisión cerrada" que `pesoMaximoTransportable`).
- **Estamina**: al revés — nada la gasta todavía (sin sprint, sin combate construidos), así que se regenera pasivamente hasta el máximo; el día que exista un gasto real (correr, golpear), solo hay que restarle en el sitio que lo dispare, `tickVitales` no cambia.
- **Sin penalización por llegar a 0** en este esqueleto — ni siquiera drenar Vida (ver §1: eso violaría la regla no-negociable de Combate "nadie se cura/daña solo con el tiempo"). Qué pasa exactamente al quedarse sin comer/beber/dormir (morir de verdad, un debuff, algo intermedio) sigue siendo `docs/Backlog_Mecanicas_Futuras.md` "Muerte y respawn — sin diseñar", explícitamente FUERA de este documento — hoy los 4 vitales solo se clampan en 0, sin más efecto.

**Sin persistencia entre sesiones** — decisión deliberada, no un olvido: el inventario ya sentó el precedente de "vive y muere con la sesión" (`docs/GDD_Inventario.md`) mientras el login siga siendo un nombre libre sin cuenta real (`docs/Backlog_Mecanicas_Futuras.md`, "identidad v1 = nombre, hasta que haya login real"). Guardar un reloj de hambre entre reconexiones sin una identidad de verdad detrás no resuelve nada que no resuelva mejor el login cuando llegue — se revisita entonces, junto con la UI (ambos "lo último", pedido explícito del streamer).

## 3. Atributos — mismo mecanismo EXACTO que oficios

"Mejoran según uso, no un nivel global" ya tenía patrón hecho: XP por atributo, nivel SIEMPRE derivado (nunca persistido en sí). Tan literal que la curva de nivel (`nivelDeXp`) se movió de `crafteo.ts` a `server/src/progresion/nivel.ts` para que oficios y atributos compartan la misma fuente en vez de dos copias idénticas — `crafteo.ts` re-exporta `nivelDeXp` tal cual, cero import roto.

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

### 3.1 Curva de niveles: 1 a 10, cada nivel pide más que el anterior (✅ 2026-08-30)

Pedido explícito: "cotar cada atributo de 1 a 10 niveles, con más XP por nivel, no sea que se leveé muy rápido al nivel 10". `generarUmbrales(nivelMax, incrementoBase)` (`server/src/progresion/nivel.ts`) genera la curva por **números triangulares** — `umbral(n) = incrementoBase * (n-1) * n / 2` — así el salto entre niveles CRECE cada vez (nunca lineal), sin tabla escrita a mano:

| Nivel | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| XP acumulada | 0 | 100 | 300 | 600 | 1000 | 1500 | 2100 | 2800 | 3600 | **4500** |
| Salto desde el anterior | — | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |

Es la MISMA fórmula que oficios ya usaba hasta nivel 6 (`generarUmbrales(6,100)` reproduce EXACTO `[0,100,300,600,1000,1500]`, sin cambiar su balance) — `UMBRALES_NIVEL_ATRIBUTO = generarUmbrales(10, 100)` solo extiende la misma progresión 4 niveles más. Llegar al 10 (4500 XP) cuesta 3x lo que costaba llegar al antiguo tope (1500 XP en nivel 6) — deliberado, para que el máximo se sienta lejano.

### 3.2 Disparadores de XP — **5 atributos, con varias formas cada uno** (✅ 2026-08-30, revisado)

Lista de atributos revisada en TRES pasadas el mismo día (ver §0-bis): `liderazgo` sale, entra `resistencia`; después `sigilo` se retira ENTERO (sin ningún sistema al que engancharlo, ni disparador ni bonus — mantenerlo como atributo "de adorno" no aportaba nada) y `comercio` se fusiona DENTRO de `carisma` (mismo atributo social: hablar con NPCs, fundar gremios Y regatear en el mercado). Lista final: **fuerza, destreza, inteligencia, resistencia, carisma**.

Pedido explícito sobre los disparadores: "que cada atributo tenga varias formas de sacar exp... todas las que tengan crafteo también crafteando o recolectando". Mismo criterio que Crafteo arrancó con una receta representativa por familia — cada disparador cuelga de una acción REAL que ya existía en el servidor, ninguno inventado para la ocasión:

| Atributo | Disparadores |
|---|---|
| **Fuerza** | `coger` un objeto "pesado" (`peso≥2`, +2 XP) — talar/minar · Golpe conectado en combate (`combate:accion`, +1 XP) — "dando golpes" |
| **Destreza** | Golpe conectado en combate (`combate:accion`, +3 XP) · Moverse en combate (`combate:mover`, +1 XP) — reflejos/agilidad |
| **Inteligencia** | Completar un crafteo (`crafteo:recolectar`, +4 XP) · `coger` CUALQUIER recurso del mundo (+1 XP, sin importar el peso) — "crafteando o recolectando" |
| **Resistencia** | Recibir un golpe en combate (+2 XP) — jugador atacado por otro jugador O por la IA de fauna/enemigo, mismo punto de aplicación · Correr 10s reales seguidos (+3 XP) · Andar 30s reales seguidos (+1 XP) — ver §3.4 |
| **Carisma** | `npc:hablar` con éxito (5 XP) · Fundar un gremio (`gremio:fundar`, 30 XP, heredado de Liderazgo) · Comprar en un tenderete (`tenderete:comprar`, +2 XP, heredado de Comercio) · Reponer/vender en tu propio tenderete (`tenderete:reponer`, +3 XP, heredado de Comercio) |

Carisma es ahora el atributo con MÁS disparadores (4) — consecuencia directa de fusionar dos atributos sociales en uno.

Detalles de implementación que importan:
- `manejarCoger` es 100% SÍNCRONO a propósito (atomicidad del pickup, ver su comentario en `RoomExteriorBase.ts`) — Fuerza/Inteligencia se otorgan con `otorgarXpAtributoPorSesion` SIN awaitear, un efecto secundario en segundo plano que no reabre esa ventana.
- **Resistencia** es el caso más delicado: el golpe puede venir de `manejarCombateAccion` (jugador ataca) o de `avanzarTurnosIA` (la IA de un enemigo/fauna ataca, sin ningún `Client` a mano ese instante) — se detecta en el ÚNICO punto donde ambos caminos convergen (`aplicarUnidadesASchema`, comparando hp antes/después) y se otorga por `sessionId` directo (`otorgarXpAtributoPorSessionId`, variante nueva de `otorgarXpAtributoPorSesion` para cuando no hay `Client`).
- El consumidor que YA tenía Fuerza (`pesoMaximoTransportable`, `docs/GDD_Inventario.md`) por fin recibe un valor real Y un límite real de verdad — ver §3.3.

Los números son placeholder de balance (mismo criterio que el resto del proyecto) — pensados para la curva de 10 niveles: a +1/+2/+3/+4 XP por acción, el máximo (4500 XP) pide cientos de repeticiones, no un puñado.

### 3.3 Qué hace cada nivel — bonus real, no solo un número que sube (✅ 2026-08-30, revisado)

Pedido explícito: "si tengo nivel 1 no me da bonus de nada, si tengo nivel 10 sí, cada nivel que tenga". Cada fórmula vive en `server/src/personaje/bonusAtributos.ts` (módulo puro, `server/test/bonusAtributos.test.ts`) — nivel 1 = el valor BASE que el juego ya tenía sin ningún atributo de por medio (nunca "0 en seco"), nivel 10 = el máximo de la curva:

| Atributo | Nivel 1 (sin bonus) | Nivel 10 (máximo) | Dónde se aplica |
|---|---|---|---|
| **Fuerza** | 20 kg transportables | 56 kg | `excedePesoMaximo` (`inventario.ts`) — comprobado ANTES de `coger`, recoger un crafteo y comprar en un tenderete. Antes la fórmula existía pero nada la llamaba (ver `docs/GDD_Inventario.md`) — ahora sí limita de verdad. |
| **Destreza** | 6 PA en combate (PA_MAX_COMBATE) | 9 PA (+1 cada 3 niveles) | `crearUnidadCombate` — más PA = más acciones por turno en combate táctico (mover/atacar/objeto/magia, un único pool desde `docs/GDD_Combate.md §9.3`). Solo aplica a jugadores. |
| **Inteligencia** | factor ×1.0 (sin cambio) | factor ×1.45 (45% más rápido) | `manejarCrafteoIniciar` — multiplica el factor de velocidad de crafteo (el mismo que ya aplicaba la energía de la construcción), nunca lo sustituye. |
| **Resistencia** | 100 HP máx (la base obligatoria) | 190 HP máx | `otorgarXpAtributo` — al subir de nivel, sube `player.vidaMax` al instante (nunca baja `vida` de golpe, solo el techo). |
| **Carisma** | cooldown de `npc:hablar` 3000ms + 0% descuento en tenderetes (los de siempre) | cooldown 1200ms + 18% de descuento | Handler `npc:hablar` (`HubRoom.ts`, "más interacciones/conversaciones") Y `comprarDeTenderete` (`bd.ts`, ambos motores, heredado de Comercio) — DOS bonus a la vez, uno por cada atributo que se fusionó aquí. El descuento reduce el precio TOTAL que paga el comprador Y el que recibe el vendedor por igual (negociación real, no crea Farycoins de la nada); el cooldown nunca baja de 1000ms (cuota de Gemini/Groq). |

Todas las fórmulas son lineales simples (o por tramos, Destreza) — mismo criterio "placeholder de balance, número de referencia" que el resto del proyecto. Carisma es el único atributo con DOS bonus simultáneos — consecuencia directa de la fusión con Comercio, ambos bonus se mantuvieron tal cual en vez de promediarlos o elegir uno.

### 3.4 Sprint (correr) — primer consumidor real de la estamina, y Resistencia por tiempo de movimiento (✅ 2026-08-30)

Pedido literal: "resistencia sube si corres durante x tiempo y andas x cantidad de tiempo también... ya daremos actividades o acciones que den exp específicamente a estas habilidades más adelante" — o sea, de partida solo hacen falta estos dos disparadores por movimiento; el resto de atributos se deja tal cual quedó en §3.2 hasta que el streamer pida disparadores concretos para ellos.

`vitales.ts:tickVitales` solo REGENERABA estamina hasta ahora (comentario propio: "nada la gasta todavía") — no había ningún sistema que la consumiera. Este pedido obliga a construir el primer: **sprint**.

- Cliente (`game.ts`): `Direction.correr` — Shift mientras se mueve, viaja en cada `room.send("input", ...)` (se re-envía también si solo cambia Shift, no solo al cambiar x/y).
- Servidor (`RoomExteriorBase.actualizarMovimiento`, autoritativo): `corriendoDeVerdad = medio TIERRA && seMueve && dir.correr && estamina > 0`. Sin esa condición, correr no hace nada distinto de andar — no hay penalización dura si se pide sprint sin estamina, simplemente no se concede la ventaja hasta que se regenere sola (mismo criterio de degradación suave que el resto del movimiento).
- Con sprint activo: velocidad `VEL_CORRER = 6` (vs `VEL_ANDAR = 3.75`) y la estamina se gasta directamente en el tick (`ESTAMINA_GASTO_POR_SEG_CORRIENDO = 15` — un sprint continuo vacía los 100 puntos en ~6.7s). El drenaje vive en `RoomExteriorBase`, no dentro de `tickVitales`, para no tocar el contrato de ese módulo puro (solo horas transcurridas, sin inputs del jugador).
- Resistencia por tiempo: tiempo REAL acumulado (no de mundo) en un mapa en memoria por sesión (`tiempoMovimiento`, vive y muere con la conexión igual que `inputs` — nunca se persiste). Solo se llama a `otorgarXpAtributoPorSessionId` (que sí toca BD) al CRUZAR el umbral, nunca cada tick a 30hz — el sobrante de segundos se conserva restando el umbral en vez de poner el contador a cero. Correr entrena más rápido que andar (umbral más corto, más XP por intervalo) porque es el esfuerzo que de verdad gasta estamina: cada 10s corriendo, +3 XP; cada 30s andando, +1 XP.

Verificación: `tsc --noEmit` limpio en `server/` y `client/`; suite completa de `server` (366/366, sin regresión — no se añadieron tests unitarios nuevos para este disparador, es lógica inline de Room del mismo tipo que ya cubría `combate.e2e.mjs` para Resistencia-por-golpe).

### 3.5 Actividades diarias de entrenamiento — un mensaje genérico, el catálogo decide qué sube (✅ 2026-08-30)

Pedido explícito: una actividad DEDICADA por atributo (más allá de los disparadores orgánicos de §3.2) que el jugador hace a propósito — "resistencia... tienes que tener unos elementos de gym, pesas o una máquina", "carisma... pregonar en la capital" — repetible una vez por DÍA DE MUNDO (`tiempoMundo().dia`, no horas reales: un jugador offline durante el día in-game no pierde el turno). Con Resistencia ya cubierta por §3.4 (correr) y Carisma pendiente del catálogo de frases de pregonero (fuera de esta pasada — el streamer lo acota en un archivo aparte), esta pasada cubre **Fuerza, Destreza e Inteligencia**.

- **Un único mensaje, no uno por actividad**: `actividad:realizar {construccionId}` (`RoomExteriorBase.manejarActividadRealizar`). Qué atributo sube y cuánta XP da NO están en el handler — están en el propio catálogo construible, campo nuevo `actividadAtributo: {atributo, xp}` en `interiores/catalogo/exteriores.json`/`elementos.json` (mismo patrón ya usado por `produccion`/`energia`, roseado a través de `EntradaConstruible` en `server/src/construccion/catalogo.ts`). Añadir una actividad nueva (p.ej. un yunque para Fuerza) es una entrada de catálogo más — cero código nuevo.
- **Reusa el sistema de construcción, no inventa uno propio**: la construcción tiene que existir de verdad en el mundo (`ctx.vivas`, la MISMA infraestructura que ya usan las mesas de crafteo) y el jugador tiene que estar a menos de `RADIO_INTERACCION` de su posición real — validado server-side, no solo confiado al cliente.
- **Anclas de catálogo** (`docs/GDD_Personaje.md` este mismo commit):
  - **Fuerza** → `pesas_entrenamiento` (nuevo, `exteriores.json`, construible por cualquier jugador en su parcela — mismo patrón que `diana_entrenamiento`).
  - **Destreza** → `diana_entrenamiento` (ya existía, exterior) y `diana_dardos` (ya existía en `elementos.json`, interior — `sala_juegos`/taberna); cualquiera de las dos vale, el cooldown es por ATRIBUTO, no por construcción, así que usar una no libera la otra el mismo día.
  - **Inteligencia** → `atril` (ya existía, `elementos.json` — biblioteca/estudio/capilla/sala_ritual).
- **Cooldown persistido de verdad**: `jugador_atributos.ultimo_dia_actividad` (columna nueva, mismo patrón de migración que el resto de `bd.ts` — `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` en Postgres, `PRAGMA table_info` + `ALTER` manual en SQLite) guarda el día de mundo de la última vez que ESE atributo cobró XP por esta vía; un segundo intento el mismo día se rechaza (`actividad:error`), uno en un día distinto vuelve a otorgar.
- **XP fija de 15 por sesión** (placeholder de balance, mismo criterio que el resto) — deliberadamente más alta que un disparador orgánico suelto (2-4 XP): es una acción dedicada de una vez al día, no un efecto colateral de jugar.

Verificación: 366/366 tests de servidor (sin regresión), 34/34 tests de catálogo de interiores (las entradas nuevas/etiquetadas no rompen la generación de las 60 tipologías de edificio), `tsc` limpio en `server`/`client`, y un E2E manual completo contra un servidor real (mapa sintético con una parcela, `Ragnar` construye pesas/diana/atril/silla-de-control): pesas otorgan Fuerza, repetir el mismo día se rechaza, diana y atril otorgan Destreza/Inteligencia de forma independiente, una construcción sin `actividadAtributo` (silla) se rechaza con el motivo correcto, una construcción real pero fuera de `RADIO_INTERACCION` se rechaza por distancia, y backdatear `ultimo_dia_actividad` a "ayer" en BD directamente demuestra que un día nuevo reabre la actividad (XP acumulada 15→30) — 15/15 comprobaciones OK.

## 4. Consumir — primer uso real de `tipo:"consumible"`

`personaje:consumir {instanciaId}` (`RoomExteriorBase.manejarPersonajeConsumir`): exige que el ítem en el cuerpo del jugador sea `tipo:"consumible"` con un campo `restaura` en el catálogo (`{vital, cantidad}`) — sin `restaura`, se rechaza en vez de desaparecer sin efecto (un consumible de contenido futuro no debe comportarse como uno real a medias). Mismo `quitarItem`/`sincronizarContenedor` que ya usa `manejarSoltar`, cero mecanismo nuevo de inventario. Si `restaura.vital==="vida"`, el handler llama a `combate.ts:curar()` sobre `player.vida` directamente en vez de pasar por `vitales.ts` (ver §1) — para el resto de vitales usa `restaurarVital`.

Dos consumibles reales de partida (aditivo en `items/catalogo/items.json`): `racion_viaje` (ya existía, ahora con `restaura: comida+40`) y `jarra_agua` (pasa de `tipo:"objeto"` a `tipo:"consumible"`, `restaura: bebida+40` — `tipo` no tenía consumidor real hasta ahora, cambiarlo es seguro). Ninguno cura `vida` todavía — el camino existe (§1) pero de partida no hay un consumible de curación en el catálogo, se añade cuando toque.

## 5. Verificación

- `server/test/vitales.test.ts` (5) y `server/test/atributos.test.ts` (4): decaimiento por hora real, clamp en 0 y en el máximo, `dt<=0` no muta nada, curva de nivel compartida, lista final de 5 atributos correcta (`liderazgo`/`sigilo`/`comercio` explícitamente rechazados como atributos válidos). No cubre `vida` (vive en `server/test/combate.test.ts`, ajeno a este documento).
- `server/test/nivel.test.ts` (5): `generarUmbrales` reproduce EXACTO la tabla de oficios antigua, la curva de 10 niveles crece de forma no lineal, tope duro en nivel 10 por mucha XP que se le dé, `nivelDeXp` sin segundo argumento sigue dando el comportamiento de oficios (compatibilidad).
- `server/test/bonusAtributos.test.ts` (6, añadido con §3.3): cada una de las 6 fórmulas de bonus — nivel 1 = valor base sin bonus, nivel 10 = máximo, monotonía entre medias, topes duros donde aplica (el descuento heredado de Comercio nunca pasa de 18%, ahora bajo el nombre `nivelCarisma`).
- `server/test/inventario.test.ts`: `excedePesoMaximo` sustituye al viejo test de `pesoMaximoTransportable` (movida a `bonusAtributos.ts`) — casos con hueco de sobra y por encima del máximo, ítem desconocido no revienta.
- Suite completa de servidor: 363/363 tras añadir la curva de 10 niveles + disparadores + bonus por nivel. `tsc` limpio en server y client.
- E2E manual (`server` real, Colyseus + SQLite, dos fases con reinicio de servidor, repetido tras la reconciliación de §1): `player.vitales`/`player.atributos` replican al cliente desde el primer tick; `personaje:consumir` rechaza una instancia inexistente; fundar gremio otorga XP persistida de verdad — 7/7 comprobaciones OK (con `liderazgo`, previa a la revisión de §3.2; el mismo `otorgarXpAtributo` sigue siendo el que aplica la XP de Carisma ahora).
- No se verificó en vivo el disparador de carisma vía `npc:hablar` (requiere `GEMINI_API_KEY`/`GROQ_API_KEY`, no disponibles en este entorno) — revisado por código, mismo helper ya probado end-to-end.
- Los disparadores y bonus de la revisión 2026-08-30 (§3.2-3.3) están revisados por código — no se repitió el E2E manual completo para cada uno, salvo `combate.e2e.mjs` (ver `docs/GDD_Combate.md`), que sí corrió de nuevo tras cada tanda de cambios (disparadores de combate, luego PA por Destreza) y confirmó que nada rompe ni cuelga el combate (el jugador terminó con menos vida, prueba de que la IA enemiga golpeó y el camino de Resistencia se ejecutó sin lanzar error).

## 6. Fuera de alcance de este esqueleto (pendiente, se afina después)

- **El descuento de Carisma (heredado de Comercio) no se muestra al comprador ANTES de comprar** — el cliente no tiene forma de previsualizar el precio con descuento en la UI del tenderete (que además sigue siendo placeholder); hoy solo se nota en el `precioTotal` que devuelve `tenderete:compraResultado` después de comprar.
- **PA por Destreza no se refleja retroactivamente en un combate ya en curso** si el jugador sube de nivel a mitad de pelea — `crearUnidadCombate` solo lee el nivel al ENTRAR en combate.
- **Carisma sigue sin actividad diaria dedicada** (§3.5) — "pregonar en la plaza" está diseñado (misma mecánica genérica `actividad:realizar`, ancla en la coordenada real de "plaza" que ya usa el NPC `pregonero` de `poblacion/`) pero bloqueado en el catálogo de frases hechas, que el streamer acota en un archivo aparte antes de implementarlo.
- Slots de equipo de armadura (cabeza/torso/piernas/brazos sobre los pivotes de `rigHumanoide.ts`) — hoy `slotEquipo` solo tiene `cinturon`/`espalda`/`manoPrincipal`/`manoSecundaria` declarados; añadir armadura es catálogo puro cuando toque, el mecanismo (`puedeEquiparEnSlot`) ya es genérico y no necesita cambios de código.
- Morir de verdad, respawn, qué se pierde — `docs/Backlog_Mecanicas_Futuras.md` "Muerte y respawn", explícitamente aparte.
- Persistencia de vitales entre sesiones — ligada a que exista login real (ver §2).
- UI de personaje (barras de vitales, panel de atributos) — "lo último", pedido explícito del streamer, junto con el resto de interfaces.
