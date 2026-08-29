# GDD — Personaje: vitales y atributos (esqueleto)

**ESTADO: APLICADA (2026-08-29), verificada — curva de niveles y disparadores ampliados (2026-08-30, ver §3.1-3.2).** Primer esqueleto del "Sistema de personaje" que `docs/Backlog_Mecanicas_Futuras.md` dejaba con la lista de estadísticas ya dada por el streamer pero sin fórmulas/persistencia cerradas. Explícitamente pactado como ESQUELETO: se afina cada pieza más adelante (mismo patrón que el bakeador de animales — arrancar con la máquina completa y pocas especies, crecer después) — login/UI son las últimas piezas del proyecto y no se tocan aquí.

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

### 3.2 Disparadores de XP — **5 de 6 atributos ya conectados** (✅ 2026-08-30, antes eran 2)

Mismo criterio que Crafteo arrancó con una receta representativa por familia en vez del árbol entero — cada disparador cuelga de una acción REAL que ya existía en el servidor, ninguno inventado para la ocasión:

- **Liderazgo** ← `gremio:fundar` (30 XP) — fundar un gremio.
- **Carisma** ← `npc:hablar` (5 XP, solo en respuesta con éxito) — ya limitado por el cooldown de 3s existente (cuota de Gemini/Groq).
- **Fuerza** ← `coger` un objeto "pesado" (`peso >= 2` en el catálogo, +2 XP) — `manejarCoger` es 100% SÍNCRONO a propósito (atomicidad del pickup, ver su comentario); la XP se otorga con `otorgarXpAtributoPorSesion` SIN awaitear, un efecto secundario en segundo plano que no reabre esa ventana. El consumidor que YA tenía Fuerza (`pesoMaximoTransportable(fuerza)`, `docs/GDD_Inventario.md`) por fin recibe un valor real detrás — aunque esa fórmula en sí SIGUE sin estar conectada a ningún límite real de peso transportable (ver Backlog).
- **Destreza** ← un golpe conectado en combate interactivo (`combate:accion`, +3 XP) — el atacante siempre es un jugador ahí (el propio handler ya lo garantiza).
- **Inteligencia** ← completar un crafteo (`crafteo:recolectar`, +4 XP) — entrena el atributo general A LA VEZ que el oficio concreto.
- **Sigilo**: se queda en nivel 1 por defecto, SIN disparador todavía — no existe ningún sistema de sigilo en el servidor que lo justifique (sería inventar un disparador falso).

Los números son placeholder de balance (mismo criterio que el resto del proyecto) — pensados para la curva de 10 niveles: a +2/+3/+4 XP por acción, el máximo pide cientos de repeticiones, no un puñado.

## 4. Consumir — primer uso real de `tipo:"consumible"`

`personaje:consumir {instanciaId}` (`RoomExteriorBase.manejarPersonajeConsumir`): exige que el ítem en el cuerpo del jugador sea `tipo:"consumible"` con un campo `restaura` en el catálogo (`{vital, cantidad}`) — sin `restaura`, se rechaza en vez de desaparecer sin efecto (un consumible de contenido futuro no debe comportarse como uno real a medias). Mismo `quitarItem`/`sincronizarContenedor` que ya usa `manejarSoltar`, cero mecanismo nuevo de inventario. Si `restaura.vital==="vida"`, el handler llama a `combate.ts:curar()` sobre `player.vida` directamente en vez de pasar por `vitales.ts` (ver §1) — para el resto de vitales usa `restaurarVital`.

Dos consumibles reales de partida (aditivo en `items/catalogo/items.json`): `racion_viaje` (ya existía, ahora con `restaura: comida+40`) y `jarra_agua` (pasa de `tipo:"objeto"` a `tipo:"consumible"`, `restaura: bebida+40` — `tipo` no tenía consumidor real hasta ahora, cambiarlo es seguro). Ninguno cura `vida` todavía — el camino existe (§1) pero de partida no hay un consumible de curación en el catálogo, se añade cuando toque.

## 5. Verificación

- `server/test/vitales.test.ts` (5) y `server/test/atributos.test.ts` (3): decaimiento por hora real, clamp en 0 y en el máximo, `dt<=0` no muta nada, curva de nivel compartida. No cubre `vida` (vive en `server/test/combate.test.ts`, ajeno a este documento).
- `server/test/nivel.test.ts` (5, añadido 2026-08-30 con la curva de 10 niveles): `generarUmbrales` reproduce EXACTO la tabla de oficios antigua, la curva de 10 niveles crece de forma no lineal, tope duro en nivel 10 por mucha XP que se le dé, `nivelDeXp` sin segundo argumento sigue dando el comportamiento de oficios (compatibilidad).
- Suite completa de servidor: 356/356 tras añadir la curva de 10 niveles + los 3 disparadores nuevos (fuerza/destreza/inteligencia). `tsc` limpio en server y client.
- E2E manual (`server` real, Colyseus + SQLite, dos fases con reinicio de servidor, repetido tras la reconciliación de §1): `player.vitales`/`player.atributos` replican al cliente desde el primer tick (vitales YA decayendo fracciones de segundo reales, prueba de que el enganche al loop de movimiento está vivo); `personaje:consumir` rechaza una instancia inexistente; `gremio:fundar` otorga 30 XP de liderazgo que sobrevive en `jugador_atributos` tras reabrir la conexión — 7/7 comprobaciones OK.
- No se verificó en vivo el disparador de carisma (`npc:hablar`) porque requiere `GEMINI_API_KEY`/`GROQ_API_KEY` configuradas (no disponibles en este entorno) — el camino de éxito que otorga la XP está revisado por código y usa el mismo helper (`otorgarXpAtributo`) ya probado end-to-end por el disparador de liderazgo.
- Los 3 disparadores nuevos (fuerza/destreza/inteligencia, §3.2) están revisados por código y usan el MISMO `otorgarXpAtributo` ya probado end-to-end por liderazgo — no se repitió el E2E manual completo para cada uno, salvo `combate.e2e.mjs` (ver `docs/GDD_Combate.md`), que sí corrió de nuevo tras añadir la llamada de Destreza dentro de `combate:accion` y confirmó que el fire-and-forget no rompe ni cuelga el combate.

## 6. Fuera de alcance de este esqueleto (pendiente, se afina después)

- **`pesoMaximoTransportable(fuerza)` sigue sin conectar a ningún límite real**: la fórmula existe y ahora recibe un `fuerza` de verdad, pero ningún handler compara el peso cargado contra ese máximo — hoy se puede cargar peso infinito. Fuerza sí sube de nivel (§3.2), pero ese nivel todavía no LIMITA nada en el juego.
- Fórmulas de bonus de Destreza/Inteligencia/Sigilo/Carisma — a definir cuando exista quien las consuma más allá de dar XP (p.ej. destreza subiendo el `alcance`/daño real en combate, no solo acumulando XP por golpear).
- Slots de equipo de armadura (cabeza/torso/piernas/brazos sobre los pivotes de `rigHumanoide.ts`) — hoy `slotEquipo` solo tiene `cinturon`/`espalda`/`manoPrincipal`/`manoSecundaria` declarados; añadir armadura es catálogo puro cuando toque, el mecanismo (`puedeEquiparEnSlot`) ya es genérico y no necesita cambios de código.
- Morir de verdad, respawn, qué se pierde — `docs/Backlog_Mecanicas_Futuras.md` "Muerte y respawn", explícitamente aparte.
- Persistencia de vitales entre sesiones — ligada a que exista login real (ver §2).
- UI de personaje (barras de vitales, panel de atributos) — "lo último", pedido explícito del streamer, junto con el resto de interfaces.
