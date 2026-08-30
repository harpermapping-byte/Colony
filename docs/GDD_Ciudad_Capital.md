# GDD — Ciudad Capital del Jarl

**ESTADO: generador implementado y probado (2026-08-29).** Es la pieza que `docs/GDD_Faccion_Bandidos.md` §8 marcaba como bloqueante nº1 ("el generador de capital, aún sin hacer") — **queda resuelta aquí**. Las otras dos dependencias de esa misma sección (construcción/parcelas fuera del Hub, y combate) **siguen sin resolver**, ver §6.

## 0. Pedido del streamer (resumen)

La ciudad capital es la posesión del ADMIN/jarl: una entidad **ÚNICA** en todo el mapa (a diferencia de `capital`/`gran_capital`, que son capitales *regionales* genéricas y pueden repetirse). Debe ser grande, con más caminos centrales, más plazas/parques/vegetación/decoración que cualquier otro asentamiento, edificios para NPCs (con sus vidas normales, igual que el resto) y huecos vacíos para que la gente construya o el jarl levante proyectos especiales. Casco viejo denso (edificios pegados, callejuelas estrechas) para el resto de edificios normales (tiendas/oficios). Campos de cultivo en el anillo más próximo a la muralla. Muralla inicial de madera, mejorable como proyecto del jarl. El anillo de fuera de la muralla se ve pero no se pisa (norma ya vigente en todo `ciudades/`).

## 1. El tier `capital_jarl`

Nuevo tier en `ciudades/catalogo/asentamientos.json`, **distinto** de `capital` (regional, ya existía, sin tocar) y de `gran_capital` (regional, sin tocar):

| campo | `capital_jarl` | `capital` (regional) | `gran_capital` (regional) |
|---|---|---|---|
| `organico.radio` | **140** | 56 | 112 |
| `muralla.material` | **empalizada** (madera) | piedra | piedra |
| `muralla.puertas` | 6 | 3 | 4 |
| `plaza` | 12 | 7 | 9 |
| `zonasVerdes` | **15** | 5 | 9 |
| `camposCultivo` (nuevo) | **14** | — | — |
| `edificios.cantidad` | **[110, 130]** | [26, 34] | [64, 80] |
| `edificios.colchonMinimo` (nuevo) | **0.5** | 1 (default) | 1 (default) |
| `parcelasReservadas` (nuevo) | **{normales: 20, especiales: 16}** | — | — |

Por qué estos números:
- **Radio 140** (2026-08-29, dos subidas seguidas pedidas por el streamer: 96→108→140): a propósito **por ENCIMA** de `gran_capital` (112), no solo cerca — a diferencia de los tiers regionales (`capital`/`gran_capital`), esta capital es una entidad ÚNICA en todo el mapa, así que no hay coste de "repetirla" por el mundo; puede permitirse ser sin más la más grande de todas. `edificios.cantidad` sube a [110,130] y `zonasVerdes`/`camposCultivo`/`plaza`/`puertas` escalan con ella para que no quede vacía. Barrido de 3 semillas a este tamaño: CERO descartes (con la red de seguridad de §3bis de red adicional).
- **`edificios.cantidad` [84,100] > `gran_capital` [64,80]** con MENOS radio (96 < 112): a propósito, es donde vive/trabaja más gente que en cualquier otro sitio (muchos NPCs con sus rutinas, ya enganchados vía `poblacion/`).
- **Muralla de empalizada** (no piedra): pedido explícito del streamer — "muralla inicial de madera que se podrá ir mejorando como proyecto del jarl". Usa el mismo valor de `material` que ya usan `aldea_pequena`/`aldea`/`campamento_barbaros` — no se inventó un material nuevo. El **mejorable a piedra más adelante** sigue el mismo patrón que `GDD_Faccion_Bandidos.md` §8.2 ya documentó para el asedio: swap de muralla por nivel aplicado solo al (re)cargar el sector, nunca reactivo en caliente. **No implementado aquí** — solo la muralla inicial.
- **`zonasVerdes: 11`, la mayor de cualquier tier** (antes el máximo era `gran_capital` con 9) y `plaza: 10` (la mayor plaza) — "más plazas, más parques, más vegetación... mucha más decoración también" del pedido. La capa de decoración/iluminación ya escala con `radio`/`plaza` sin campo propio (ver `generar.js`), así que no hizo falta un campo nuevo para "más decoración": sale sola de un radio y plaza mayores.

## 2. Casco viejo: callejuelas apretadas (`edificios.colchonMinimo`)

El fitting Poisson+rechazo de `generar.js` (`colocarEdificio`/`probarCandidato`) ya usaba un colchón fijo de **1 casilla** entre solares (constante `1` pasada como `extra` a `rasterizarPiezas`) — el callejón mínimo que separa un edificio de sus vecinos. Se hizo **configurable por tier**: `def.edificios.colchonMinimo` (nuevo campo, `?? 1` si no está — los tiers existentes no cambian de comportamiento).

`capital_jarl` usa **0.5** — la mitad del margen de siempre (1 casilla combinada entre dos solares vecinos, en vez de 2). Es el "casco viejo/casco céntrico" pedido: edificios más pegados, callejones más estrechos.

**Por qué 0.5 y no menos**: se probó por debajo (0.35 y 0.7-0.8 con RNG desfavorable) y aparecía un fallo real, no cosmético — con margen insuficiente algunos edificios quedan **sellados topológicamente** por sus vecinos (ningún hueco caminable alrededor), y el paso de reparación de conectividad (A* que talla una senda hasta la puerta más cercana) no tiene NINGÚN camino que tallar: la puerta queda de verdad inalcanzable, y `validarCiudad` lo rechaza. Se barrieron 11 semillas distintas a tamaño real (radio 96, 84-100 edificios) con `colchonMinimo: 0.5` y las 11 salieron válidas — es el valor más apretado que se demostró fiable. **Riesgo residual documentado**: al ser un fitting con densidad muy alta, no hay garantía matemática de que CUALQUIER semilla salga válida — si el bake de producción del streamer topara con una semilla inválida (`hornearCiudad` lanza excepción con el listado de errores), la solución es re-hornear con otra semilla, exactamente igual que ya puede pasar (en teoría) con cualquier otro tier.

## 3. Parcelas reservadas (huecos SIN construir)

La pieza nueva de verdad. Tras generar la lista de "candidatos a solar" (edificios reales del tier + `def.edificios.obligatorios`), se añaden **entradas pseudo-edificio** sin `tipoEdificioId` ni interior:

- `parcelasReservadas.normales` (20): huella igual a un solar de vivienda/tienda normal (`huellas.porRiqueza.modesta`, 9×7) — para futura vivienda de jugador.
- `parcelasReservadas.especiales` (16 = **14** proyectos del jarl listados hoy en `docs/Backlog_Mecanicas_Futuras.md` § "Proyectos especiales del jarl" **+ 2** de margen, contados programáticamente de esa sección en el momento de implementar esto — si la lista crece, este número NO se actualiza solo, hay que revisarlo a mano): huella 1.6× la normal (14×11 — similar a los edificios obligatorios más grandes del tier, ayuntamiento 14×10 / arena_combate 14×11) — para los proyectos comunales del jarl.

Estas entradas se **mezclan** en la misma lista que los edificios reales y pasan por el **mismo** `sort` (obligatorios primero, luego por tamaño descendente) y el **mismo** `colocarEdificio` — compiten en igualdad de condiciones por el mejor sitio junto a una calle, con el mismo colchón. La única diferencia es un flag `reservado: true`: `colocarEdificio(ed, true)` sigue marcando el colchón (`ocupado`) para que nadie más invada ese hueco, pero:
- **NO** pinta `terreno` a `"solar_edificio"` — el terreno base (césped/tierra) queda intacto.
- **NO** abre puerta ni senda de conexión — un hueco vacío no tiene puerta.

Resultado: un hueco real, caminable, con césped/tierra alrededor — no un "descampado marcado como obra". Export: campo nuevo `parcelasReservadas` en `indice.json` (`[{tipo: "especial"|"normal", x, y, rot, ancho, largo}]`), listo para cuando exista construcción-en-regiones (§6).

**Mejor esfuerzo, no garantizado**: igual que con los edificios normales (`descartados`), si no hay sitio la parcela simplemente no se reserva — no bloquea el bake. Medido en el barrido de 11 semillas: `especiales` encontró sitio para las 16 completas siempre (van primero, por tamaño); `normales` varió entre 0 y 20 según la semilla (compite en igualdad con el resto de edificios pequeños del tier, que además son ~90). Documentado como comportamiento esperado, no un bug — un test cubre que NUNCA se reserva de más de lo pedido y que ninguna reservada se solapa con calle/agua/otro solar/edificio real (`ciudades/test/ciudad.test.js`).

## 3bis. Red de seguridad: un edificio sin sitio no se pierde (2026-08-29)

Pedido del streamer al ver la primera imagen de prueba: la ciudad "debería tener de todo, o al menos parcelas para construcciones futuras de esas" — que un edificio del listado se quede fuera por falta de sitio no debería significar perder su contenido sin más.

`colocarEdificio` seguía dejando en `ciudad.descartados` (solo un log, `"sin sitio: casa_modesta, herreria..."`) cualquier edificio no obligatorio que no encontraba hueco a SU tamaño real. Ahora, tras la pasada normal de colocación, cada descarte no-obligatorio se reintenta una vez más con la huella PEQUEÑA de una parcela reservada normal (`wResNormal`×`hResNormal`, la misma que usa §3) — un hueco más pequeño tiene más posibilidades de encontrar sitio donde el edificio original no cabía. Si encuentra sitio, se añade a `parcelasReservadas` como una `normal` más (con `origenDescarte: "<tipoEdificioId>"` para trazabilidad, no afecta a la cuenta configurada en el tier — es un extra, no sustituye a `resDef.normales`). Si tampoco encuentra sitio ni siquiera a ese tamaño, se queda en `descartados` de verdad (caso límite, no observado en las 4 semillas probadas tras subir el radio a 108).

Resultado: la ciudad "tiene de todo, o al menos deja reservado el hueco para construirlo más adelante" — nunca pierde contenido en silencio sin dejar ni rastro.

## 4. Campos de cultivo (`camposCultivo`)

No existía nada parecido en `ciudades/` (confirmado por búsqueda antes de tocar código). Decisión de **menor fricción**, tal como pedía el encargo: reusar el mismo tratamiento que un **huerto** de `zonasVerdes` (círculo de `tierra_labrada` + valla de madera con hueco de entrada hacia la calle) en vez de inventar una capa nueva — comparten exportación (siguen viajando dentro del array `zonasVerdes` del `indice.json`, sin canal nuevo), solo que:

- Se generan con `tipo: "campo_cultivo"` (distinguible de `"huerto"`/`"parque"`).
- Se fuerzan a una **banda pegada a la cara interior de la muralla** (`d = radio - grosor - r - 1 - aleatorio(0..8)`, medido desde el focal) en vez de la banda intermedia que usan parques/huertos normales — así caen en el anillo más próximo al lienzo, tal como pidió el streamer.
- Van **dentro** del polígono de la muralla (zona pisable de verdad): la norma "el anillo de fuera de la muralla no se puede pisar" ya existente en `ciudades/` (§8 de `GDD_Bakeador_POIs.md`, terreno `extramuros`) sigue aplicando sin tocarla — los campos nunca caen ahí, se comprobó por test que su terreno queda `tierra_labrada` (pisable) y su distancia al focal es ≤ `radio - grosor`.

`camposCultivo` es un entero fijo por tier (10 en `capital_jarl`, 0 en el resto por defecto). **Pendiente explícito, sin mecanismo**: el pedido dice "se podrán añadir más a futuro por cuenta del jarl" — hoy no existe ningún sistema para "añadir un campo de cultivo más" en caliente (post-bake); solo se deja el número inicial. Cuando exista un mecanismo de proyectos del jarl que amplíe el asentamiento (mismo tipo de sistema que mejoraría la muralla, §6), ahí es donde encajaría.

## 5. Verificación (tests)

`ciudades/test/ciudad.test.js` — 13 tests, todos en verde (`cd ciudades && node --test test/ciudad.test.js`), los 9 de siempre + 4 nuevos, seguidos al final del archivo:

1. **`capital_jarl: muralla de empalizada, casco apretado (colchón bajo) y determinismo`** — variante de tamaño reducido (radio 42, `catalogoAsentamientos` inyectado en memoria, mismo patrón que el resto del archivo) para que sea rápida; confirma `muralla.material === "empalizada"`, `colchonMinimo < 1`, y determinismo (misma semilla ⇒ mismo `terreno.datos`/`parcelasReservadas`; semilla distinta ⇒ difiere).
2. **`las parcelas reservadas ... salen sin edificio real ni solape`** — usa el tier a **tamaño real** (no la variante reducida: a radio/densidad bajos los 12 obligatorios del tier se comen todo el hueco y no queda sitio para reservar nada, probado) con la semilla `"s2"`, que encuentra hueco para las 20 normales + 16 especiales completas; valida recuento exacto, que las especiales sean mayores que las normales, y que ninguna reservada pise `"solar_edificio"` ni las casillas de un edificio real (reutilizando `rasterizarRectRotado` de `geometria.js`, el mismo rasterizador que usa el generador, para no introducir falsos positivos de redondeo).
3. **`las parcelas reservadas nunca exceden lo pedido ... (mejor esfuerzo)`** — 3 semillas más, solo exige ciudad válida y recuento ≤ lo pedido (nunca de más).
4. **`los campos de cultivo caen en zona PISABLE, pegados a la cara interior de la muralla`** — terreno `tierra_labrada` en cada campo, distancia al focal ≤ `radio - grosor + 1`.

**No se horneó la capital final de producción** (radio 96 completo con `interiores/`+`fauna`+`overview.png` reales) — eso lo corre el streamer, como en cualquier otro tier grande. Sí se corrió `exportarCiudad` de punta a punta sobre una `ciudad` generada en memoria (tamaño real, semilla `s2`) como comprobación manual de que `indice.json` lleva `parcelasReservadas` y que `zonasVerdes` lleva las entradas `campo_cultivo` — no forma parte de la suite permanente, fue una verificación puntual antes del commit.

## 6. Pendiente (no resuelto aquí, a propósito)

- **Construcción/parcelas fuera del Hub — RESUELTO (2026-08-29)**: `docs/GDD_Construccion.md` §1bis extiende el sistema a cualquier `RegionRoom` cuyo bake traiga `parcelasReservadas` (hoy la capital). Deja de ser bloqueante para el resto de puntos de esta sección.
- ~~**Colocar los proyectos especiales del jarl en las parcelas grandes reservadas** depende ahora SOLO de UNA cosa...~~ **HECHO (2026-08-30), ver `docs/GDD_Construccion.md` §1ter.** Las parcelas `tipo:"especial"` ya tienen tratamiento propio (`Parcela.tipo` + validación `proyectoJarl` en `validarColocacion`), y 13 de los 14 proyectos ya son `construible:true` en `interiores/catalogo/tipos_edificio.json` (el 14º, Estatua del Líder, en `exteriores.json`, sin interior).
- **Mejora de la muralla (madera → piedra) como proyecto del jarl**: solo se generó el estado inicial (empalizada). El mecanismo de "swap por nivel al recargar el sector" que mejoraría la muralla NO está implementado — mismo patrón que `GDD_Faccion_Bandidos.md` §8.2 ya dejó anotado para el Taller de Asedio, reutilizable aquí cuando toque.
- **"Más campos de cultivo por proyecto del jarl"**: sin mecanismo, ver §4 — solo el número inicial (`camposCultivo: 10`).
- **Combate** (la otra dependencia de `GDD_Faccion_Bandidos.md` §8.1) sigue exactamente igual de sin resolver que antes — este documento **no** la destraba.
- El orden de dependencias de `GDD_Faccion_Bandidos.md` §8.3 pasa a: ~~1. Generador de capital~~ (hecho) → ~~2. Construcción/parcelas en regiones~~ (hecho, 2026-08-29) → 3. Crafteo por planos → 4. Combate.
