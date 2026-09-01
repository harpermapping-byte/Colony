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

## 6. Fuera de alcance de esta pasada (2026-08-30)

- Nieve acumulable, partículas de lluvia/nieve/viento — pedido
  explícitamente aparte por el streamer. **Hecho en la pasada 2026-09-01,
  ver §7 en adelante.**
- Wiring real de `quitaFrio`/`quitaCalor` al servidor (§3, gap
  documentado) — necesita slots de equipo de torso/piernas primero.
- Luces urbanas por clima (antorchas apagándose con lluvia/viento, etc.)
  — el canal `indice.luces` de `ciudades/` sigue sin consumirse en
  runtime (mismo pendiente que `GDD_Tiempo_Mundo.md` "Qué falta").
- HUD con clima/estación en pantalla — junto con el resto de interfaces
  de personaje (`GDD_Personaje.md §6`).

---

# Pasada 2026-09-01 — nieve acumulable, lluvia/niebla/viento visuales, hielo

Pedido explícito del streamer: lluvia con charcos decorativos, nieve que se
acumula en el suelo por niveles (ralentiza al caminar, más cuanto más
nivel), agua que se congela en hielo cuando nieva (no se nada, se
desliza), niebla/viento como sprites que limitan un poco la vista, y que
la lluvia riegue los cultivos mientras la nieve les pausa el crecimiento.
Todo con **placeholders sencillos** (mismo criterio que el resto del
proyecto — el arte real llega en otra pasada sin tocar la maquinaria).

## 7. Temperatura — una sola curva anual, sin saltos entre estaciones

Sustituye la base fija por estación de §1: `temperaturaMundo(diaDelAnio, hora)`
(`server/src/mundo/clima.ts` + `client/src/mundo/clima.ts`) sale de un
coseno ANUAL (mínimo en la mitad de invierno, máximo en la mitad de
verano, transición gradual — nunca un escalón al cruzar de estación) más
el coseno DIARIO de siempre (mínimo ~03:00, máximo ~15:00) encima.
Constantes en `assets/mundo/clima.json`: `temperaturaMediaAnualC=15`,
`amplitudAnualC=17`, `amplitudDiariaC=6`, `diaPicoVeranoDelAnio=135` (mitad
del bloque "verano") — dan exactamente **-5°C en la madrugada de mitad de
invierno y 35°C en la tarde de mitad de verano**, el rango pedido por el
streamer. `estacionYDiaDelAnio(dia)` (nuevo export de `tiempoMundo.ts`,
servidor y cliente) deriva estación+día-del-año de cualquier día de mundo
— lo usa `clima.ts` y el acumulador de nieve (§9) para mirar hacia atrás.

## 8. Clima por FRANJA horaria, no por día entero

El día se parte en 4 franjas de 6h (`madrugada`/`mañana`/`tarde`/`noche`,
`clima.json.franjas`) con tirada INDEPENDIENTE cada una
(`climaDeFranja(dia, franjaIdx, estacion)`, mismo hash determinista de
siempre sobre `dia*4+franjaIdx`) — así puede nevar de madrugada y escampar
por la tarde el mismo día, pedido explícito del streamer. El catálogo ya
NO tiene "lluvia"/"nieve" como estados propios: `estados` es
`soleado/nublado/precipitacion/viento/niebla`, y **el tipo concreto de
precipitación lo decide la temperatura DE ESA FRANJA**
(`tipoConcreto(estado, temperaturaC)`: `<= umbralNieveC (5)` → nieve, si no
→ lluvia) — "nieva siempre entre -5 y 5 grados" sale solo de la
temperatura, sin tabla aparte que mantener sincronizada a mano, y de paso
da probabilidad de nieve MÁS ALTA hacia el corazón del invierno y menor
hacia sus bordes (verificado en `clima.test.ts`) sin necesidad de pesos
por mes. `niebla`/`viento` tienen el mismo peso de precipitación que
antes lo tenía el catálogo — solo son un sprite que limita vista (§11),
no interactúan con temperatura/nieve.

`estadoClimaEnHora(dia, hora, estacion, diaDelAnio)`: el TIPO es el de la
franja a la que pertenece esa hora (no cambia a media franja); la
TEMPERATURA es la curva continua real de esa hora exacta (no se queda
pegada al valor representativo de la franja) — así el frío/calor corporal
(§3) no da saltos al cruzar de franja. `estadoClimaDelDia`/
`temperaturaMundoDelDia` son las conveniencias que además derivan
estación/día-del-año solas, para llamar con solo `dia`/`hora` a mano
(usadas por `RoomExteriorBase.ts` y `cicloDia.ts`).

## 9. Nieve acumulada — acumulador GLOBAL sin guardar estado

`server/src/mundo/nieve.ts` + `client/src/mundo/nieve.ts` (mismo par de
siempre): `nivelNieve(dia)` da un nivel 0..`nivelMaximoNieve` (4 en el
catálogo) **para TODO el mapa exterior a la vez** (no por casilla — pedido
explícito: "capa de nieve se aplica a todo el mapeado"). Regla exacta,
por día, recorrida hacia atrás:

- sube 1 (con tope) el día en que **alguna** franja nevó
  (`algunaFranjaNevo`).
- baja 1 el día en que **ninguna** franja nevó Y la temperatura de la
  franja "tarde" supera `umbralDeshieloC` (5).
- se mantiene igual en cualquier otro caso (frío pero sin nevar ese día
  concreto) — así si vuelve a nevar, el nivel sigue subiendo desde donde
  se quedó, NUNCA desde 0 (pedido explícito del streamer).

Sin guardar nada en BD ni mandar nada por red: se DERIVA recorriendo hacia
atrás `ventanaFoldDiasNieve` (45) días desde el día pedido, arrancando en
nivel 0 — como el nivel nunca sube/baja más de 1 por día y tiene tope 4,
45 días de margen (medio invierno) es de sobra para que el resultado sea
el mismo que arrancar desde el principio del mundo, verificado en
`nieve.test.ts` (nunca se acarrea de un invierno a dos inviernos después,
nunca da un salto >1 entre días consecutivos, llega al tope en inviernos
de sobra probados). Coste: ~180 evaluaciones baratas (hash+coseno) por
llamada — se recalcula una vez por tick de servidor (no por jugador,
`RoomExteriorBase.ts`) y cada ~15s en cliente (`game.ts`), nunca más
seguido: el nivel cambia como mucho una vez por día de mundo.

## 10. Efectos de la nieve — ralentiza, congela el agua, pausa cultivos

- **Ralentización en tierra** (`multiplicadorVelocidadPorNieve(nivel)` en
  `nieve.ts`, lineal: `1 - nivel*0.15`, tope 0.4 al nivel máximo):
  multiplica la velocidad ya calculada en `actualizarMovimiento`
  (`RoomExteriorBase.ts`) exactamente como ya hacen fractura/gripe/pociones
  — solo en tierra, no sobre hielo (esa velocidad ya es la propia del
  hielo) ni nadando. **Gap documentado a propósito**: la fauna salvaje
  (`faunaSalvajeViva.ts`) NO lee `mundo.velocidad` como el jugador (tiene
  su propio sistema de movimiento más simple), así que hoy solo el
  jugador se ralentiza en nieve — pedido explícito "si pasas por ahí
  animales o personas" incluía animales, pero engancharlo a la IA de
  fauna es un cambio aparte que no se ha tocado en esta pasada.
- **Hielo** (agua + `nivelNieve>0`): el jugador de a pie (no montura/barco
  — no se ha pedido que también resbalen) deja de nadar — la casilla se
  trata como tierra a efectos de estado/velocidad, sin tocar
  `TIPO`/`mundo.casillas` (evita tocar fauna/pathfinding/barcos/pesca, que
  siguen viendo agua normal ahí). Corre más rápido que andando
  (`VEL_HIELO=5`) pero CON deslizamiento: en vez de mover al jugador al
  instante como el resto de medios, `velocidadHieloPorSesion` guarda una
  velocidad con inercia que converge a la velocidad objetivo por
  suavizado exponencial cada tick (`FRICCION_HIELO=0.12`,
  `actual += (objetivo-actual)*friccion`) — con el tick fijo del servidor
  (`TICK_HZ=30`) esto es estable sin más física. Sigue deslizando aunque
  se suelte el input (objetivo pasa a 0, tarda varios ticks en pararse) y
  dejar de pisar hielo borra la inercia al instante. Se limpia en
  `onLeave` como el resto de mapas por sesión.
- **Cultivos** (`server/src/cultivo/cultivo.ts`): un día de lluvia riega
  como si se hubiera regado a mano ESE mismo día
  (`ultimoDiaLluviaReciente`, mira los últimos `DIAS_VENTANA_RIEGO` (4,
  derivado de `100/DECAIMIENTO_AGUA_POR_DIA`) días — el mismo tramo en el
  que la lluvia todavía importaría para el nivel de agua). Un día con
  nieve acumulada en el suelo (`nivelNieve(d) > 0`) NO cuenta para el
  calendario de crecimiento (`diasCrecidosSinNieve`): la cosecha no se
  pierde, simplemente ese día no avanza el contador — se recupera en
  cuanto se derrite.

## 11. Visual — capa de nieve por sector, hielo, partículas, charcos

Todo PLACEHOLDER (mismo criterio que el resto del arte del proyecto — se
sustituye sin tocar la maquinaria cuando el streamer apruebe arte real).

- **Capa de nieve** (`client/src/render3d/sectorVisual.ts`): un plano
  semitransparente MÁS por sector (no una malla por casilla — carísimo),
  construido en el mismo bucle que ya pinta el canvas de terreno,
  excluyendo agua/hielo por máscara (alfa 0 en esos píxeles). Opacidad
  (hasta 0.85) y altura (hasta 0.22) suben linealmente con el nivel
  0..4 — nunca se reconstruye la geometría/textura al cambiar de nivel,
  solo se retocan esas dos propiedades (`actualizarNieveSector`,
  `aplicarNivelNieveAPlano`), así que actualizar TODOS los sectores
  cargados cuando cambia el nivel global (una vez al día, `game.ts` lo
  comprueba cada 15s) es barato. Se libera con el mismo mecanismo de
  limpieza de GPU que ya tenía el resto de `sectorVisual.ts`
  (`userData.propioDelSector`).
- **Hielo**: las casillas de agua se pintan de un tono frío opaco
  (`COLOR_HIELO`) en vez del agua translúcida de siempre, en el mismo
  bucle. **Simplificación documentada**: esto se decide con el nivel de
  nieve que había AL MATERIALIZAR el sector, no es reactivo — si el
  jugador se queda quieto en un sector ya cargado y la nieve se derrite
  del todo, el hielo visual no vuelve a agua hasta que el sector se
  suelta y se recarga (el streaming ya lo hace solo al alejarse/volver).
  La mecánica de juego (bloquear nadar, velocidad+deslizamiento) SÍ es
  100% reactiva porque se recalcula cada tick en el servidor — solo el
  pintado tiene este retraso.
- **Partículas** (`client/src/render3d/climaVisual.ts`, clase
  `EfectosClima`): `THREE.Points` de lluvia/nieve cayendo y polvo a la
  deriva (viento), activados/desactivados según `ciclo.clima` de
  `cicloDia.ts`, siempre centrados en `objetivoCamara` (nunca fijos en
  coordenadas de mundo — así vale para cualquier punto de un mapa de
  miles de casillas sin generar nada por streaming aparte).
- **Charcos**: `THREE.CircleGeometry` oscuros semitransparentes, un pool
  fijo de 14 recolocados al azar alrededor del jugador SOLO al empezar a
  llover (no cada frame) — decorativos, sin efecto de juego ("no como un
  río", pedido explícito). Usan `Math.random()` a propósito: es parpadeo
  visual efímero client-only, no generación de mundo (la regla "nunca
  Math.random() en generación" es para contenido bakeado/determinista).
- **Niebla/viento** (`worldScene.ts`): `THREE.Fog` de verdad (acorta lo
  visible, no tapa la pantalla) — niebla fuerte (`near:3, far:15`),
  viento flojo (`near:10, far:30`), pedido explícito "que vea peor, pero
  que vea, una pequeña molestia". `FACTOR_LUZ_CLIMA` (§4) gana la entrada
  `niebla: 0.75`.
- Sonda de depuración `window.__clima()` (mismo criterio que
  `window.__colonyDebug`/`__streaming`) expone el clima resuelto del
  frame actual.

## 12. Verificación

- `server/test/clima.test.ts` (17): franjas, determinismo, extremos exactos
  -5°C/35°C, rango nunca se sale de [-5,35] muestreado, `tipoConcreto`
  nieve/lluvia por temperatura, nunca nieva en pleno verano, sí nieva en
  mitad de invierno, más nieve en el corazón del invierno que en sus
  bordes (el "tapering" pedido), `temperaturaTarde`/`estadoClimaEnHora`/
  conveniencias.
- `server/test/nieve.test.ts` (7): determinismo, 0 en pleno verano, nunca
  fuera de [0,4], nunca salta más de 1 entre días consecutivos, llega a
  acumular y a tocar el tope en inviernos de sobra probados, nunca se
  acarrea de un invierno a dos inviernos después.
- `server/test/cultivo.test.ts`: +4 tests sobre la suite existente (24
  total) — lluvia riega como riego a mano, un día nevado no cuenta para
  el calendario de crecimiento; los tests viejos de decaimiento puro se
  reescribieron para aislar la interferencia real de la lluvia (buscan
  programáticamente un día/ventana sin lluvia en vez de un número fijo,
  ya que ahora SÍ puede llover en cualquier día probado).
- Suite completa de servidor: **1119/1119** en verde, `tsc --noEmit`
  limpio en `server` y `client`, `vite build` del cliente sin errores.
- **Verificación visual** (Playwright,
  `client/test/climaVisual.e2e.mjs`): arranca servidor+cliente reales
  sobre el mapa demo, fuerza día/hora con `DIA_FORZADO`/`?dia=` a tres
  escenarios (nieve acumulada al tope, lluvia, niebla) y captura pantalla
  — las tres cargan sin errores de página, `window.__clima()` en cliente
  coincide con el clima calculado en servidor para lluvia/niebla
  (confirma que la derivación por temperatura funciona igual en los dos
  lados sin sincronizar nada), y la capa de nieve se comprobó por
  diferencia de píxel (mismo criterio que el filtro de estación de §4: a
  ojo desnudo el cambio es sutil sobre una captura pequeña, pero
  numéricamente el terreno sale consistentemente más claro con nivel de
  nieve al máximo que sin nieve en los mismos puntos de pantalla).

## 13. Fuera de alcance de esta pasada

- Fauna salvaje ralentizada por nieve (§10, gap documentado) — su sistema
  de movimiento no comparte tabla de velocidad con el jugador.
- Hielo visual reactivo en un sector ya cargado (§11) — se corrige solo
  al recargar el sector (alejarse/volver), la mecánica de juego no tiene
  este retraso.
- Monturas/barcos sobre hielo: siguen tratando el agua como agua normal
  (nadan/flotan igual) — no se ha pedido que también resbalen.
- Nieve visible sobre props/tejados/personajes — pedido explícitamente
  descartado para esta pasada ("sobre objetos muebles y edificios o
  personas y animales no se ve nada el efecto nieve, como mucho afecta
  velocidad nada más").
- HUD de clima en pantalla — sigue junto al resto de interfaces
  pendientes (`GDD_Personaje.md §6`).
