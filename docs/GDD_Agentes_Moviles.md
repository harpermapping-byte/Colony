# Agentes móviles — paths y rutinas para NPCs, bárbaros y fauna (v1)

## Decisión (confirmada con el streamer, 2026-08-28)

UN solo sistema de "agente que sigue un camino" para todo lo que se mueve
sin jugador detrás: NPCs de asentamiento, bárbaros/enemigos y fauna local.
Lo que cambia entre ellos es el **cerebro** (quién decide el próximo
destino), nunca el **cuerpo** (cómo se recorre el camino y se publica la
posición). Así los patrones de movimiento de fauna y las patrullas de
bárbaros llegan después sin tocar el runtime — solo añaden su cerebro.

## Reglas duras (filosofía del proyecto aplicada al movimiento)

1. **Paths bakeados, nunca A\* en vivo.** Los caminos de rutina los
   precalcula `poblacion/` en el bake (A* de ciudades/ con caché, ya
   existente). Si en runtime un camino falta o falla, el agente NO
   recalcula: se teletransporta a su destino y se apunta el fallo en el
   log — un teleport raro es más barato y más depurable que un pathfinder
   colgado del tick.
2. **Solo cuesta lo vivo.** Los agentes solo existen en rooms con
   jugadores: las regiones autodisponen al vaciarse y, al recrearse, cada
   NPC se RECOLOCA según su rutina y la hora del reloj de mundo
   (GDD_Tiempo_Mundo) — el estado de un agente es DERIVABLE, no se
   persiste nada.
3. **La hora manda.** El cerebro de rutina consulta `tiempoMundo()` del
   servidor (autoridad). Un NPC no "recuerda" qué le toca: se calcula de
   la hora, así el mismo asentamiento a la misma hora siempre está igual.
4. **Sin colisión agente-jugador (v1).** Los caminos bakeados son
   transitables por construcción; los agentes van "sobre raíles" y los
   jugadores los atraviesan. El empuje PJ-PJ no aplica. Si algún día un
   agente bloquea algo, será decisión de diseño, no un accidente.

## Arquitectura

### El cuerpo: `server/src/mundo/agentes.ts`

Autómata de 3 estados por agente, común a todos los tipos:

- **QUIETO** — en su punto, con una `accion` publicada ("trabajar",
  "dormir", "misa"...) que el cliente puede usar para animar/mostrar.
- **VIAJANDO** — recorre su polilínea `{x,y}[]` a velocidad de andar de
  NPC (más lenta que el jugador: 1.9 casillas/s) avanzando por segmentos;
  al agotar la polilínea pasa a QUIETO.
- **(reservado)** — PERSIGUIENDO/HUYENDO para bárbaros/fauna: mismo
  cuerpo, cerebro futuro.

El gestor (`GestorAgentes`) tickea dentro del `setSimulationInterval` que
ya corre la room (30 hz) — coste por agente: unas sumas. La posición se
publica en el estado Colyseus (`state.npcs`, MapSchema como `players`) y
viaja con el mismo patchRate de 15 hz; el cliente interpola igual que a
los jugadores.

### Los cerebros

- **Rutina (NPC, v1 — implementado):** cada NPC trae del bake su rutina
  `[{lugar, accion, horaInicio, horaFin, punto, camino}]`. El cerebro
  compara la hora con los tramos: tramo nuevo → si hay `camino` bakeado
  desde el tramo anterior, VIAJANDO por él; si no, teleport. Al crear la
  room, cada NPC nace YA en el punto de su tramo activo (regla 2).
  Un NPC "en casa" desaparece del mapa exterior (está dentro del
  edificio; los interiores instanciados lo mostrarán en su día): se marca
  `visible=false` y el cliente lo oculta.
- **Merodeo (fauna — pendiente, diseño cerrado):** parámetros por especie
  en su catálogo (`radio`, `pausaSeg`, `velocidad`): elegir casilla
  transitable aleatoria a ≤radio del punto de spawn ANDANDO EN LÍNEA con
  paradas (sin A*: si la línea tropieza con no-transitable, se acorta el
  tramo), pausa, repetir. Determinista por semilla de spawn + día.
- **Patrulla (bárbaros — pendiente, diseño cerrado):** anillo de
  waypoints bakeado con el campamento (mismo mecanismo que los caminos de
  rutina); el cerebro los recorre en bucle. La agresión (detectar
  jugador, PERSEGUIR) es mecánica de combate futura — este GDD solo deja
  el hueco del estado.

### Los datos: `poblacion.json` junto al mapa

`poblacion/src/exportarAsentamiento.js` ya generaba todo en memoria;
ahora además se vuelca al bake del mapa:

```
assets/mapas/<mapa>/poblacion.json
  { npcs: [{ slotId, nombre, oficio, rutina: [tramos con punto+camino],
             vox: PersonajeExportado }] }
```

`vox` es el personaje YA generado (mismo formato que consume
`crearPersonajeVoxel` en el cliente — el de demo_personajes.json): el
cliente pinta al NPC real sin generar nada en vivo. ~65 KB por NPC,
estático y cacheable.

La `RegionRoom` carga `poblacion.json` si existe junto a su mapa y
arranca el gestor; si no existe, la región simplemente no tiene NPCs
(mapas viejos siguen funcionando).

## NPCs especiales, guardias y ocio (v1.1 — pedido del streamer 2026-08-28)

### Especiales

NPCs únicos con path más marcado y personalidad de calle. TODO entra por
catálogo (`poblacion/catalogo/especiales.json` + arquetipo en
`personajes/catalogo/npcs.json` + entrada de censo + perfil en
`perfilesSociales.json` — cero código por especial nuevo). La probabilidad
de que un asentamiento concreto los tenga es su `cantidad [0,1]` del censo.

Implementados: **vagabundo** (sin casa ni trabajo: deambula pidiendo, se
sienta en la plaza, duerme a la intemperie — visible SIEMPRE), **párroco**
(vive EN el templo, misa por la mañana, pasea bendiciendo), **pregonero**
(recorre la ciudad de día contando novedades — el texto real del pregón
llegará del canal de historias del servidor), **melonero** (ronda las
calles con su grito "¡Vendo melones!" y remata en la plaza; su burro y
carreta son arte futuro).

Los `grito` van en el estado (`Npc.grito`) y el cliente los enseña en
burbuja periódica (~4 s cada ~13, desfasada por NPC).

### Guardias (todo asentamiento con muralla)

Uniforme por catálogo (tabardo+pantalón de cuero: misma prenda + mismo
material = mismo look). Reparto por índice entre los censados
(`asignarEspeciales.js`): primero 2 por puerta de muralla — turno de DÍA y
turno de NOCHE en la MISMA puerta, 12 h cada uno, en el lado INTERIOR del
anillo (a ~2.5 casillas hacia la plaza) — y el resto a rondas (bucle por
todas las puertas pasando por la plaza) alternando día/noche. Fuera de
turno hacen vida: dormir, comer, ocio y taberna. De noche el cliente les
enciende una ANTORCHA (PointLight con parpadeo) mientras vigilan/patrullan.

### Ocio aleatorio diario (todos los NPCs)

Los perfiles normales cambian su tarde fija por un tramo `ocio` que se
resuelve DISTINTO cada día por semilla (npc, día): taberna, plaza, sentarse
en una zona verde, mirar una tienda o un paseo corto. Misma plantilla, días
que no se repiten — la variación diaria de horarios (jitter) ya existía.

### Dormir bajo techo y el déficit de camas

Cadena de "casa" en `generarRutina`: vivienda → si no hay, DUERME DONDE
TRABAJA (el guardia en el cuartel, el cura en el templo, el panadero en la
trastienda — de época) → si tampoco, la posada como pensión. Antes el
déficit de camas dejaba al NPC sin rutina (invisible); ahora todo el censo
sale al mapa. La visibilidad es por tramo: bajo techo (en casa o durmiendo
donde le tocó) no se pinta en el exterior; `dormir_calle` del vagabundo sí.

### Segunda tanda de especiales (v1.2, 2026-08-28 — OK del streamer: "las 14 idea me valen")

Los 13 con esqueleto humanoide, IMPLEMENTADOS con el mismo mecanismo de
catálogo (arquetipo + censo por tier + perfil social + `especiales.json`).
Solo el nº14 queda fuera porque es fauna, no un NPC:

1. **Borracho** (`borracho`) — duerme la mona en cualquier banco (`sinCasa`), tarde entera en la taberna, tambaleo por la calle de noche.
2. **Chismosa** (`chismosa`) — deambula de puerta en puerta "cotilleando" todo el día — el lugar `deambular` ya reutiliza las puertas de edificios/tiendas como paradas, es justo el efecto buscado.
3. **Bardo malo** (`bardo_malo`) — canta en la plaza toda la tarde; el efecto "la gente se aparta" queda como reacción visual futura (animación), no mecánica todavía.
4. **Profeta/loco de las profecías** (`profeta`) — deambula de día "profetizando" y remata en la plaza al anochecer.
5. **Recaudador** (`recaudador`) — ronda las TIENDAS del asentamiento (`ronda_tiendas`, pool nuevo de paradas); la escolta de guardia queda como simplificación v1 (dos NPCs enlazados es mecánica futura).
6. **Duelista jubilado** (`duelista_jubilado`) — entrena en la plaza mañana y tarde.
7. **Vendedora de amuletos** (`vendedora_amuletos`) — reusa el perfil `vendedor_ambulante` (ronda+plaza) con su propio grito: "¡Amuletos de eficacia garantizada!".
8. **Niño perdido** (`nino_perdido`) — morfología pequeña, deambula "buscando a su familia"; devolverlo es micro-misión futura.
9. **Pescador mentiroso** (`pescador_mentiroso`) — nuevo lugar `rio`: orilla real más cercana a su casa (`tilesDeAgua`/`puntoDeAgua`, mismo patrón de caché que los huertos); sin agua intramuros cae a la plaza.
10. **Sepulturero** (`sepulturero`) — nuevo lugar `templo`; turno NOCTURNO 20→7 (cruza medianoche) cerca del templo, duerme de día.
11. **Mimo/estatua** (`mimo`) — tramo largo e inmóvil en la plaza; la reacción "se mueve si te acercas" queda pendiente (necesita detección de proximidad a jugador).
12. **Coleccionista de gallinas** (`coleccionista_gallinas`) — deambula "buscando gallinas"; la interacción real con fauna queda aparcada (no hay fauna urbana viva todavía).
13. **Corredor** (`corredor`) — NO fuerza perfil (reparto normal de `asignarPerfil`, cualquier rutina le vale): solo se le marca `velocidad: 1.8` en `especiales.json`, que `agentes.ts` aplica como multiplicador de `VEL_NPC` — mecanismo genérico reutilizable para huir/perseguir en el futuro.
14. **Gato/perro del pueblo** — sigue APARCADO: es fauna urbana viva (un animal, no un personaje), necesita su propio tipo de agente sobre `animales/` en vez de `personajes/` — no es un simple catálogo nuevo, es una pieza de motor distinta.

## Vida en interiores (v1.2, pedido del streamer 2026-08-28)

"La familia también socializa si tienen familia en interior de sus casas,
también salen y entran de instancias como PJ, entre aldea y los
interiores": implementado a nivel de ESTADO — un NPC está en la región
(exterior, visible=false si está en casa) o dentro de su interior
(InteriorRoom), nunca en los dos a la vez, y cuál le toca lo decide la
MISMA hora del reloj de mundo en los dos sitios. No hay una animación de
"cruzar la puerta" en tiempo real (eso sigue pendiente, ver abajo) — el
salto es de estado, coherente con la regla dura de "nunca A* en vivo".

- `poblacion/src/generarRutina.js` ya calculaba `tramo.sala` (qué sala de
  la casa toca en cada tramo, GDD_Poblacion_NPCs); ahora ADEMÁS anota
  `npc.casaEdificioId` — qué interior es "su casa" (vivienda real, o el
  edificio donde duerme por la cadena de respaldo del déficit de camas).
  Se exporta en `poblacion.json` (`escribirPoblacionDeMapa`).
- `server/src/mundo/interiorColision.ts`: `cargarInterior()` calcula
  `salasPorTipo` — una casilla pisable real por tipo de sala de la planta
  (mismo criterio que el spawn: el centro geométrico corregido al hueco
  libre más cercano, por si un mueble cae justo en el centro).
- `server/src/mundo/agentesInterior.ts` (`poblarInterior`): al crear una
  `InteriorRoom`, si el asentamiento tiene `poblacion.json`, coloca ahí a
  todo NPC cuyo tramo activo (por la hora) sea "casa" en ESTE edificio y
  ESTA planta — en la sala que le toca. Se recalcula cada 20s mientras la
  room vive (un jugador puede quedarse dentro cuando cambia el tramo: la
  familia se va a dormir, alguien llega de trabajar). La familia entera
  aparece junta SOLA, sin enlazar NPCs a propósito: viven en el mismo
  edificio y sus rutinas caen en franjas horarias parecidas (dormir de
  noche, cenar a la misma hora).
- Jitter determinista pequeño por NPC (hash de su `slotId`) para que
  varios compañeros de piso no queden exactamente apilados en el mismo
  punto — visible sobre todo en asentamientos con déficit de vivienda
  (varios NPCs duermen en el mismo dormitorio comunal de la posada).
- Cliente: el fetch de `poblacion.json` (vóxeles por slotId) ahora también
  se hace en un interior, usando `mapaId` (el asentamiento) en vez de la
  ruta del propio interior — comparten un único `poblacion.json` por
  pueblo/ciudad.

### Verificado (v1.2)

Tests: `server/test/interiorColision.test.ts` (salasPorTipo da un punto
pisable real por sala) y `server/test/agentesInterior.test.ts` (6 casos:
familia junta a la hora correcta, nadie dentro en horas de trabajo, solo
entra quien vive AHÍ, un cambio de tramo saca al NPC, sala inexistente cae
al spawn sin romper, planta equivocada no entra). E2E real: entrando de
noche (23h forzada) en la planta con dormitorio comunal de una posada de
`ciudad_demo` aparecen los residentes reales (nombres distintos, vóxeles
reales) en la sala correcta con los muebles bakeados alrededor.

## Zonas comunes sin apelotonarse + vendedores especializados fijos (v1.3, pedido del streamer 2026-08-28)

### No se apelotonan

Plaza, taberna, banco (zona verde) y cada sala de interior ya no son un
único punto que todo el mundo comparte: `poolAlrededorDe()`
(`poblacion/src/generarRutina.js`) genera un anillo de hasta 10 casillas
transitables reales alrededor del centro, y `elegirDePool()` reparte por
turno rotatorio (`contadorZonas`, un contador MUTABLE compartido por TODO
el asentamiento, creado una vez en `exportarAsentamiento.js`) — dos NPCs
que coincidan en la misma zona, a cualquier hora, nunca reciben la misma
casilla. Lo mismo dentro de una sala de interior: `salasPorTipo` ahora da
hasta 6 casillas pisables por sala (no solo el centro) y
`agentesInterior.ts` las reparte igual, por turno, dentro de cada pasada
de `poblarInterior`. Un jitter mínimo de desempate solo entra si hay más
NPCs que puntos disponibles (el ciclo se repite).

Alcance deliberado: esto resuelve el caso que se pidió arreglar —
NPCs QUIETOS en una zona común no comparten casilla. No es colisión física
en movimiento (dos NPCs VIAJANDO no se esquivan a mitad de camino) — eso
sigue siendo un desarrollo aparte si hiciera falta, coherente con "nunca
A* en vivo": no se quiso meter una física de separación por tick para
agentes que ya van sobre raíles bakeados.

### Vendedores especializados fijos por asentamiento

Los oficios de tienda/taller (tendero, panadero, sastre, joyero, alfarero,
curtidor — `poblacion/catalogo/oficiosEdificios.json`, ya existían) ahora
tienen un SUELO garantizado por tier en el censo
(`poblacion/catalogo/censo.json`): aldea_pequena 4 fijos, pueblo 5-10,
capital 7-16, gran_capital 9-19, castillo 2-3 — "cada aldea/ciudad/castillo
tiene SIEMPRE varios vendedores", como se pidió. Si el asentamiento no
tiene edificio-tienda de sobra para todos (`asignarUbicacion.js`), el
vendedor sin hueco recibe un **puesto de mercado exterior** (mismo pool
rotatorio que la plaza) en vez de quedarse sin trabajo visible — así no
hace falta forzar un edificio-tienda por cada vendedor.

**Trabajando de verdad dentro de la tienda**: se generaliza "vida en
interiores" (antes solo `casa`) a `trabajo` — `npc.trabajoEdificioId`
(espejo de `casaEdificioId`) + `tramo.sala` calculado también para el
tramo de trabajo (`accionesPorSala.json` ganó la clave `"trabajar"`:
`sala_comercio`/`taller`/`capilla`/`arsenal`/cocinas). `InteriorRoom` ya
no distingue "casa" de "trabajo": pone dentro a quien encaje por CUALQUIERA
de los dos motivos. Entrar a una tienda en horario laboral enseña al
tendero de verdad, junto al mostrador.

### Verificado (v1.3)

Tests: `poblacion/test/rutina.test.js` (reparto de plaza en casillas
distintas; suelo garantizado de vendedores en aldea_pequena; puestoExterior
cuando no hay tienda), `server/test/agentesInterior.test.ts` (4 NPCs de la
misma sala en 4 casillas distintas; un tendero aparece dentro de SU tienda
en horario de trabajo, no fuera de horario). E2E real: panadería de
`ciudad_demo` a mediodía — los 2 panaderos reales aparecen juntos en la
sala_comercio junto al mostrador (captura); plaza con NPCs ya en casillas
distintas, no apilados.

## Verificado (v1)

- Test de servidor del gestor: recolocación por hora al crear room,
  transición de tramo → VIAJANDO por el camino bakeado, llegada → QUIETO,
  teleport con camino ausente.
- E2E visual: región con población bakeada, NPCs pintados con su vox real
  moviéndose por las calles a la hora que les toca (hora forzada).

## Qué falta (pendiente, no bloquea)

- Cerebros de merodeo (fauna) y patrulla-con-agresión (bárbaros) — diseño
  cerrado arriba, llegan con sus mecánicas.
- ~~NPCs dentro de interiores instanciados~~ **RESUELTO (v1.2)**, ~~NPC
  dentro de su lugar de trabajo~~ **RESUELTO (v1.3)**: ver "Vida en
  interiores" y "Vendedores especializados" arriba. Sigue pendiente el
  PULIDO visual: no hay animación real de cruzar la puerta (el salto
  exterior↔interior es de estado, no un paseo hasta el umbral) y dentro de
  casa/tienda el NPC no camina entre salas — aparece QUIETO en la que le
  toca. `taberna`/`posada` siguen sin un `tipoSalaId` de trabajo claro en
  `accionesPorSala.json` (cayeron a `cocina`/`sala_comun`, compartido con
  otras acciones) — el tabernero puede no encontrar sala y quedarse junto
  a la puerta; no rompe nada, pero es menos preciso que tienda/taller.
- Hablar (F) con el NPC que pasa por delante: `npc:hablar` ya existe en
  el Hub; conectar el id del agente al gestor de conversaciones cuando
  el diálogo IA salga de su pausa (decisión del streamer: aparcado).
- Animación de andar del rig del NPC sincronizada con VIAJANDO (el rig ya
  anda para jugadores; pasar el flag).
- Burro y carreta del melonero (composición agente+animal+prop) — arte y
  mecánica futuros; de momento el melonero va a pie con su pregón.
- Sentarse de verdad (pose del rig) para "pedir_sentado"/bancos — hoy el
  NPC se queda de pie en el sitio; la pose llega con las animaciones.
