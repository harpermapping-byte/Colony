# GDD — Clima, estaciones y temperatura corporal

Pedido explícito y literal del streamer, 2026-08-30 (mismo mensaje que
§3.6 de `docs/GDD_Personaje.md`, separado aquí por tamaño — ver esa
sección §6 donde quedó anotado como pendiente antes de esta pasada).

## 1. Calendario — 12 meses de 30 días, 4 estaciones de 3 meses

`assets/mundo/tiempo.json` tenía `diasPorEstacion:7` (placeholder de la
primera pasada de `docs/GDD_Tiempo_Mundo.md`, sin nada más que dependiera
de él). Ahora: `diasPorMes:30`, y `diasPorEstacion`/`diasPorAño` se
**derivan** en código (`DIAS_POR_ESTACION = diasPorMes * 3`,
`DIAS_POR_ANIO = DIAS_POR_ESTACION * 4`) en `server/src/mundo/tiempoMundo.ts`
y `client/src/mundo/tiempoMundo.ts` — nunca duplicados como número suelto
en el JSON, mismo criterio que el resto de constantes del calendario.

`tiempoMundo()` gana un campo nuevo `mes` (1..12) además de `estacion`,
calculados ambos a partir de `diaDelAnio = dia % DIAS_POR_ANIO`. `dia`
sigue siendo el mismo contador de días completos desde la época
(`assets/mundo/tiempo.json.epocaUnixMs`) que ya usaba `tiempoMundo()`
— cero mecanismo nuevo, solo más derivados de él.

Debug: `?dia=95` en la URL del cliente (mismo criterio que `?hora=19.5`
ya existente) fuerza el día para saltar a una estación/clima concretos sin
esperar el reloj real; el servidor tiene el equivalente por variable de
entorno `DIA_FORZADO`. Ninguno de los dos afecta a la simulación real
salvo que se fuerce explícitamente — mismo patrón que `HORA_FORZADA`.

## 2. Clima — un estado determinista por DÍA, cero red

Mismo criterio arquitectónico que la propia `tiempoMundo()`: servidor y
cliente calculan el MISMO resultado sin sincronizar nada por red.

- `assets/mundo/clima.json` — catálogo: `estados` (soleado/nublado/lluvia/
  viento/nieve), `pesosPorEstacion` (tabla de pesos por estación — solo
  invierno tiene `nieve` con peso > 0; el resto de estaciones lo dejan en
  0), `temperaturaBasePorEstacion` (grados aprox. por estación) y
  `amplitudTermicaDiaria` (oscilación día/noche).
- `server/src/mundo/clima.ts` y `client/src/mundo/clima.ts` — mismo par
  cliente/servidor que `tiempoMundo.ts`, funciones puras sobre el JSON:
  - `climaDelDia(dia, estacion)`: hash entero determinista del día
    (mismo criterio de mezcla que `hashDeterminista` de
    `server/src/combate/seleccionArena.ts`, adaptado de string a número)
    elige un estado por peso — **nunca cambia a media día**, nunca usa
    `Math.random()`.
  - `temperaturaMundo(estacion, hora)`: curva coseno simple sobre la base
    de la estación, mínimo de madrugada (~03:00), máximo a media tarde
    (~15:00).
  - `estadoClima(dia, estacion, hora)`: conveniencia que junta ambas.

Sin partículas de lluvia/nieve ni nieve acumulable todavía — pedido
explícitamente aparte por el streamer ("mas adelante me gustaria meter un
sistema de nieve acumulable"), esto es solo el estado + su efecto visual
de luz (§4) y el gasto de vitales por temperatura extrema (§3).

## 3. Temperatura corporal del jugador

Nuevo vital `Vitales.temperatura` (0-100, `TEMPERATURA_NEUTRA=50`,
`server/src/personaje/vitales.ts` + `VitalesSchema.temperatura` en
`HubState.ts`) — vive FUERA de `tickVitales` porque necesita la
temperatura del mundo como dato externo (mismo motivo por el que
`aplicarInanicion` también es una función aparte).

- `objetivoTemperaturaCorporal(temperaturaMundoC)`: temperatura corporal
  "ideal" para una temperatura de mundo dada — 15°C de mundo = 50 neutro,
  sube/baja 2.5 puntos de corporal por grado de mundo, clamp a [0,100].
- `aplicarTemperaturaCorporal(v, temperaturaMundoC, horasTranscurridas)`:
  cada tick, `v.temperatura` DERIVA hacia el objetivo (hasta
  `TASA_DERIVA_TEMPERATURA_POR_HORA=15` puntos por hora, nunca de un
  salto) — el cuerpo tarda en aclimatarse, no salta instantáneo con el
  mundo. Si `temperatura >= UMBRAL_CALOR_EXTREMO(75)` gasta `bebida` extra
  y devuelve `"calor"`; si `<= UMBRAL_FRIO_EXTREMO(25)` gasta `comida`
  extra y devuelve `"frio"`; dentro del rango cómodo no hace nada y
  devuelve `null`.
- `RoomExteriorBase` llama a `aplicarTemperaturaCorporal` en el mismo tick
  de vitales, con `temperaturaMundo(estacion, hora)` de `tiempoMundo()`
  del servidor, y pasa si hubo extremo a `aplicarInanicion` (§3.6 de
  `GDD_Personaje.md`) con su 7º parámetro `tambienReducirVidaMax` —
  **reutiliza el mismo mecanismo de reducción de `vidaMax` que la
  inanición** en vez de un sistema de debuff paralelo. Decisión de diseño
  deliberada, literal del pedido ("resistencia baja"): la temperatura
  extrema por sí sola NUNCA daña `vida` directamente (solo recorta
  `vidaMax` si hacía falta) — solo el hambre/sed real (`comida`/`bebida`
  a 0) hace daño paulatino. Si ambas cosas coinciden, el hambre real
  manda y sigue dañando igual que antes.

**Gap de infraestructura, documentado a propósito**: `ropa/catalogo/
prendas.json` ya declara `quitaFrio`/`quitaCalor` por prenda (0-100,
orientativo: lana/cuero abrigan más, lino ligero da más frescor) pero el
sistema de equipo del servidor **todavía no lee ropa vestida** para
aplicarlo a `objetivoTemperaturaCorporal`/`aplicarTemperaturaCorporal` —
hoy el jugador sufre la temperatura del mundo desnuda de cualquier
mitigación de vestuario. Cablear esto necesita que exista primero un slot
de equipo real de torso/piernas (`GDD_Personaje.md §6`, "Slots de equipo
de armadura" — mismo hueco pendiente). Cuando exista, el enganche es
sumar los `quitaFrio`/`quitaCalor` de lo equipado como una reducción de
`|temperaturaMundoC - 15|` antes de llamar a `objetivoTemperaturaCorporal`.

## 4. Efecto visual — filtro de estación + atenuación de clima

`client/src/render3d/cicloDia.ts`, función `aplicarEstacionYClima()`,
aplicada al final de `estadoCiclo()` (mutación en sitio sobre el
`colorCielo`/`colorLuz`/intensidades ya calculados por la hora — nunca
los sustituye):

- **Filtro de estación** (`FILTRO_ESTACION`): multiplicador de color
  cercano a `(1,1,1)` por estación — primavera azulado/verde, verano
  cálido/brillante, otoño beige (menos azul), invierno blanquecino/frío
  — pedido explícito "que sea muy sutil". Se multiplica entero sobre
  `colorCielo` y a mitad de fuerza (`lerp` 0.5 con blanco) sobre
  `colorLuz` — el sol/la luna ya tienen su propio color por hora, esto
  solo lo desplaza un poco.
- **Atenuación por clima** (`FACTOR_LUZ_CLIMA`): nublado/lluvia/nieve
  bajan `intensidadLuz`/`intensidadAmbiente` un poco (0.7-0.9), soleado
  no toca nada (1.0), viento casi no afecta a la luz (0.95) — es un
  estado de ambiente, no de cielo cubierto.
- `EstadoCiclo.clima` (nuevo campo, el tipo elegido por `climaDelDia`)
  queda expuesto para que una UI futura lo muestre sin recalcular nada.

## 5. Verificación

- `server/test/tiempoMundo.test.ts` (5): día 0 = mes 1/primavera, `mes`
  se mantiene en [1,12] a lo largo de 400 días muestreados, día 90 = mes
  4/verano, día 360 da la vuelta a mes 1/primavera/año 1, las 4
  estaciones miden exactamente 90 días cada una.
- `server/test/clima.test.ts` (8): determinismo de `climaDelDia` (mismo
  día siempre da el mismo clima), variedad real a lo largo de muchos
  días, `nieve` NUNCA aparece fuera de invierno (200 días comprobados por
  estación no invernal) pero SÍ aparece en invierno (300 días), verano
  más cálido que invierno a la misma hora, 15h más cálido que 3h en la
  misma estación, determinismo de `temperaturaMundo`, `estadoClima`
  combina ambas cosas bien.
- `server/test/vitales.test.ts` (+13 nuevos sobre la suite de §3.6):
  `aplicarInanicion` con `tambienReducirVidaMax=true` recorta `vidaMax`
  sin dañar `vida` si no había hambre real, sí recorta `vida` si superaba
  el nuevo tope, hambre real + temperatura extrema sigue dañando igual
  (el hambre manda), `objetivoTemperaturaCorporal` neutro a 15°C y
  monótono, clamp a [0,100] con temperaturas de mundo absurdas,
  `aplicarTemperaturaCorporal` deriva sin sobrepasar el objetivo de un
  salto, calor/frío extremos gastan el vital correcto y devuelven el
  string correcto, rango cómodo no gasta nada, nunca sale de [0,100],
  `horasTranscurridas<=0` no hace nada.
- **Verificación visual** (Playwright, mismo criterio que
  `GDD_Tiempo_Mundo.md` — mapa de ciudad de prueba, capturas a
  `hora=13` fijo y `dia=45/135/225/315`, mitad de cada estación): las 4
  capturas NO son distinguibles a simple vista (el filtro es
  deliberadamente sutil, tal y como se pidió) pero SÍ lo son
  numéricamente — comparación pixel a pixel entre pares de estaciones da
  entre el 78% y el 99.8% de píxeles distintos, y el color de cielo
  puro esperado por matemática (`CIELO_DIA` multiplicado por cada
  `FILTRO_ESTACION`) confirma el orden de diseño: primavera e invierno
  con más azul (204/210 de canal B), verano intermedio (190), otoño el
  más beige/cálido (174, el de menos azul) — coincide exactamente con lo
  pedido ("verano más luminoso, otoño beige, invierno blanco, primavera
  azulado/verde"). No se compara a ojo desnudo sobre la captura completa
  porque el resto de la escena (muros, tejados, vegetación) diluye un
  desplazamiento de unos pocos puntos sobre 255 — la comprobación
  numérica es la que demuestra el comportamiento, no la captura sola.
- `tsc` limpio en `server` y `client`.
- No se hizo un E2E de servidor real contra el efecto de temperatura
  extrema sobre vitales en vivo (mismo motivo que la inanición en §3.6 de
  `GDD_Personaje.md`: forzar horas reales de exposición no es viable) —
  cubierto entero por los tests puros de `vitales.test.ts`.

## 6. Fuera de alcance de esta pasada

- Nieve acumulable, partículas de lluvia/nieve/viento — pedido
  explícitamente aparte por el streamer.
- Wiring real de `quitaFrio`/`quitaCalor` al servidor (§3, gap
  documentado) — necesita slots de equipo de torso/piernas primero.
- Luces urbanas por clima (antorchas apagándose con lluvia/viento, etc.)
  — el canal `indice.luces` de `ciudades/` sigue sin consumirse en
  runtime (mismo pendiente que `GDD_Tiempo_Mundo.md` "Qué falta").
- HUD con clima/estación en pantalla — junto con el resto de interfaces
  de personaje (`GDD_Personaje.md §6`).
