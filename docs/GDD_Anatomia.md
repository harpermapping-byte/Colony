# GDD — Anatomía y medicina

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30).** Pedido del streamer: profundizar el sistema de vida 0-100, acotar tipo de daño por arma, y vincularlo a un oficio de médico real. Trajo un spec técnico externo (genérico, sin contexto de este repo) como punto de partida — este documento explica qué se adoptó tal cual, qué se adaptó a la arquitectura real del proyecto y por qué, y qué se decidió con el streamer cuando el spec dejaba huecos reales.

## 0. Decisiones de arquitectura (por qué esto no es una copia literal del spec externo)

- **`Player.vida/vidaMax` sigue siendo la ÚNICA fuente de HP** (docs/GDD_Mecanicas.md §5.4, regla ya no-negociable). El sangrado/infección le restan a ESA vida por el mismo canal que cualquier otro daño — nunca un HP paralelo por zona, que es lo que el spec externo sugería con un `AnatomyComponent` independiente.
- **Sin tick de servidor propio.** El spec externo pedía "en el Loop/Tick del servidor (cada X segundos)". Este proyecto tiene una regla de arquitectura explícita (CLAUDE.md §"Filosofía técnica"): cálculo perezoso, nunca un bucle de fondo nuevo. El drenaje por sangrado/infección y el cierre de la fase "cicatrizando" son **perezosos**, con el MISMO integrador `horasTranscurridas` que ya usa `tickVitales`/`aplicarInanicion` (`server/src/personaje/vitales.ts`) — se llaman desde el mismo tick de movimiento que ya existía, sin ningún `setInterval` nuevo.
- **Alcance: solo jugadores.** Animales/NPCs siguen con el modelo de vida plana de `combate.ts` — no llevan las 6 zonas. Mismo principio ya aplicado ("los animales no tienen defensa").
- **6 zonas = los pivotes YA EXISTENTES del rig** (`cabeza`/`torso`/`brazoIzq`/`brazoDer`/`piernaIzq`/`piernaDer`, `client/src/render3d/rigHumanoide.ts`) — coincide exacto con lo que pedía el spec, cero trabajo nuevo de esqueleto.
- **`choza_curandero` + oficio `curandero` + `mesa_diagnostico`/`mesa_cirugia`** ya existían en el catálogo (`docs/GDD_Profesiones.md`) sin ninguna mecánica enganchada — esto es exactamente ese enganche, no un sistema nuevo de oficio.
- **Probabilidades y curación, pedidas literalmente por el streamer** (no del spec externo, que dejaba esto sin definir): 20% de sangrado y 1% de amputación por golpe CORTANTE (tiradas independientes — "de 100 golpes, uno amputa de media, pero es aleatorio"), 10% de fractura por golpe CONTUNDENTE, autocuidado (venda/tablilla) más lento y peor que la cirugía del curandero.

## 1. Las 6 zonas (`server/src/personaje/anatomia.ts`)

`cabeza`, `torso`, `brazoIzq`, `brazoDer`, `piernaIzq`, `piernaDer`. Por zona: `sangrado`, `fractura`, `infectado`, `amputado`, `protesis` (booleanos) + `vendadoDesde`/`entablilladoDesde` (timestamps server-only, fase de cicatrización en curso — nunca viajan al cliente crudos, ver §6).

Solo las 4 extremidades son `ZONAS_AMPUTABLES` — cabeza/torso no se amputan (no tiene sentido, sería letal directo).

## 2. Tipo de daño por arma (`items.json::tipoDano`)

| arma | tipoDano |
|---|---|
| daga, espada_corta, espada_larga, hacha_combate | cortante |
| maza_guerra, honda | contundente |
| lanza, arco_corto, arco_largo, ballesta | perforante |

`magico`/`fuego` reservados en el tipo (`"cortante" \| "contundente" \| "perforante" \| "magico" \| "fuego"`) para cuando existan armas de ese tipo — sin efecto propio todavía, ningún arma del catálogo los usa (CLAUDE.md §7, "las listas crecen"). Puño limpio (sin arma equipada) cuenta como `contundente`.

## 3. Probabilidades por golpe conectado (pedidas literalmente, `resolverGolpeAnatomico`)

- Se sortea una zona uniforme entre las 6.
- **Cortante o perforante**: 20% de sangrado en esa zona.
- **Cortante, además**: 1% de amputar esa zona — SOLO si es amputable (extremidad) y tirada INDEPENDIENTE del sangrado.
- **Contundente**: 10% de fractura en esa zona.
- Solo se aplica si el OBJETIVO es un jugador conectado y sigue en pie tras el golpe (si murió, la herida no aporta nada).

## 4. Drenaje y curación — perezosos, mismo integrador que `tickVitales`

- **Sangrado activo**: 3 vida/hora por CADA zona sangrando.
- **Infección activa**: 1.5 vida/hora por CADA zona infectada — no se detiene vendando, solo la cirugía la cura.
- **Crítico**: por debajo del 10% de `vidaMax`. Bloquea que comida/pociones normales curen `vida` (`manejarPersonajeConsumir`/`aplicarUnVital`) y reduce la velocidad de movimiento (×0.5) — la única salida es la cirugía.
- **Penalización de movimiento/combate**: pierna comprometida (fractura activa, o amputada sin prótesis) → ×0.25 de velocidad. Brazo comprometido → bloquea atacar (arena táctica y PvP simple), equipar en `manoPrincipal`, y `crafteo:iniciar` — solo permite consumir objetos sobre uno mismo, pedido literal ("solo permite usar consumibles/curas"). **Alcance consciente**: NO se tocó cada verbo de herramienta del juego uno a uno (cocina, pesca, agricultura...) — sería decenas de sitios; se gateó en los 3 puntos de mayor impacto (combate, equipar arma, crafteo).

### Autocuidado (venda/tablilla) — cualquiera, sin oficio, PEOR que la cirugía

- **Vendar** (`venda`, item craftado por sastre): detiene el sangrado activo AL INSTANTE, pero la zona entra en fase "cicatrizando" (`vendadoDesde`) con un malus leve de velocidad (×0.9) durante 3 horas reales. Sin `unguento` aplicado a la vez, 25% de riesgo de que la herida se infecte durante esa fase.
- **Entablillar** (`tablilla`, item craftado por carpintero): mismo patrón sobre la fractura, fase "soldando" (`entablilladoDesde`) de 6 horas reales.
- **Infección**: NO la cura el autocuidado normal — solo la cirugía.

### Cirugía y prótesis — oficio curandero, la vía "buena" de curación

- **`medico:cirugia`**: exige oficio `curandero`, `instrumental_cirugia` en el inventario (herramienta REUSABLE, no se consume — misma convención que `cuchillo_desollar`), estar junto a `mesa_cirugia`, y el PACIENTE junto a una cama/camilla (`esCama`, cualquier cama del catálogo sirve — "que te tumbes en camilla o cama", pedido literal). Cura sangrado/fractura/infección de las 6 zonas AL INSTANTE; si el paciente estaba en crítico, lo saca (restaura vida al umbral del 10%). NO revierte amputaciones.
- **`medico:protesis`**: exige oficio `curandero` + estar junto a `mesa_diagnostico` + `protesis_madera` en el inventario (SÍ se consume). Solo sobre una zona amputada sin prótesis previa — la instala, anula su penalización, el cliente cambia la malla a un tono de madera.

### Respawn — "respawneas sano", pero no gratis del todo

Al morir (`manejarMuerteJugador`), la anatomía se limpia con la MISMA `operarCirugia()` (sangrado/fractura/infección) — reuso directo, sin duplicar lógica — pero **amputaciones/prótesis NO se revierten**: son permanentes hasta que un curandero de verdad instale una prótesis.

## 5. Ítems y recetas nuevas

| ítem | oficio | mesa | insumos |
|---|---|---|---|
| `venda` | sastre | `telar` | tela_hilada |
| `unguento` | herbolista | `mortero_grande_boticario` | miel + fruta |
| `tablilla` | carpintero | `banco_carpintero` | madera_blanda |
| `protesis_madera` | curandero | `mesa_diagnostico` | madera_dura + cuero_curtido |
| `instrumental_cirugia` | herrero | `yunque_tocon` | lingote_hierro |

5 oficios distintos tocados — "vincúlalo con lo que ya tenemos" cumplido de punta a punta: molinero/panadero ya se habían enganchado en cocina v2 el mismo día, ahora sastre/herbolista/carpintero/curandero/herrero.

## 6. Sincronización cliente — Schema y visual

`Player.anatomia` (`AnatomiaSchema`, `HubState.ts`) replica SOLO las 6 booleanas que el cliente necesita pintar por zona (`sangrado`/`fractura`/`infectado`/`amputado`/`protesis`/`curando`) — los timestamps de cicatrización viven server-only (`RoomExteriorBase.anatomiaPorSesion`, un `Map<sessionId, Anatomia>` completo con timestamps, mismo criterio que `montadoPorSesion`), nunca cruzan la red crudos (mismo principio que `calentandoDesde` de cocina.ts).

**Visual del rig** (`client/src/render3d/anatomiaVisual.ts`): reusa el mecanismo YA EXISTENTE "buscar el pivote por nombre" de `equipoVisual.ts` — los pivotes de `rigHumanoide.ts` ya se llaman `cabeza`/`torso`/`brazoIzq`/etc., coincidencia exacta con las Zonas. Amputado sin prótesis → oculta el pivote entero (`visible=false`). Con prótesis → lo muestra tintado del mismo tono de madera que `estructura_palos`/`tablilla`. Se aplica en el `onChange` que YA existe por jugador (local Y remoto) en `game.ts`, mismo sitio que ya refresca vida/equipo/montura — sin listener nuevo.

## 7. Huecos honestos que quedan

- **Cliente**: `panelMedico.ts` es el mismo tipo de PLACEHOLDER de testeo que el resto de paneles del proyecto (inputs de sessionId a mano para elegir paciente, sin picker de "jugador cercano" real).
- **Bloqueo de brazo roto acotado a 3 verbos** (combate, equipar arma, crafteo) — cocina/pesca/agricultura/construcción no lo comprueban todavía, decisión de alcance explícita (ver §4).
- **Sin ponderación de zona por tamaño real** — el sorteo de zona es uniforme entre las 6 (torso/cabeza más grandes en la vida real, pero simplificado a propósito en v1, igual que el resto de placeholders de balance del proyecto).
- **`instrumental_cirugia`/nombres de ítems médicos son mi propia invención** para cerrar el hueco de "instrumentos" que pedía el streamer — si prefiere otro nombre/material, es un cambio de catálogo trivial.
- **Sin mágico/fuego todavía** — el campo `tipoDano` ya los contempla, pero no hay ningún arma de ese tipo en el catálogo ni efecto (quemadura que bloquea cura, del spec externo) construido; se añade cuando exista la primera arma real de ese tipo.
