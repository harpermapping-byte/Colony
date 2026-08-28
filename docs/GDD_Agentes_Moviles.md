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

### Ideas propuestas (pendientes del OK del streamer — no implementadas)

1. **El borracho del pueblo** — sale de la taberna haciendo eses, duerme en cualquier banco.
2. **La chismosa** — va de puerta en puerta y se para "a hablar" con cada NPC que cruza (ideal para IA).
3. **El bardo malo** — canta en la plaza y los NPCs cercanos se apartan un paso.
4. **El loco de las profecías** — señala al cielo y suelta profecías absurdas sobre "el fin del reino".
5. **El recaudador de impuestos** — va de tienda en tienda con un guardia de escolta; todos lo miran mal.
6. **El duelista jubilado** — viejo con espada de madera que entrena contra un poste.
7. **La vendedora de amuletos** — "amuletos de dudosa eficacia", promesas exageradas a grito.
8. **El niño perdido** — corretea por la ciudad; devolverlo a su madre puede ser micro-misión futura.
9. **El pescador mentiroso** — junto al agua contando el pez gigante que casi pesca (crece cada día).
10. **El sepulturero** — de noche pasea con pala y farol cerca del templo; de día duerme.
11. **El mimo/estatua** — inmóvil en la plaza; si un jugador se acerca mucho, se mueve de golpe.
12. **El coleccionista de gallinas** — persigue gallinas por la ciudad (cuando haya fauna urbana).
13. **El "corredor"** — siempre va corriendo a todas partes como si llegara tarde a algo.
14. **El gato/perro del pueblo** — fauna urbana especial que sigue a gente aleatoria (con la fauna).

## Verificado (v1)

- Test de servidor del gestor: recolocación por hora al crear room,
  transición de tramo → VIAJANDO por el camino bakeado, llegada → QUIETO,
  teleport con camino ausente.
- E2E visual: región con población bakeada, NPCs pintados con su vox real
  moviéndose por las calles a la hora que les toca (hora forzada).

## Qué falta (pendiente, no bloquea)

- Cerebros de merodeo (fauna) y patrulla-con-agresión (bárbaros) — diseño
  cerrado arriba, llegan con sus mecánicas.
- NPCs dentro de interiores instanciados (hoy: visible=false bajo techo).
  Diseño pendiente de detallar: cuando un jugador está en el interior de
  un edificio, los NPCs cuyo tramo activo cae en ese edificio deberían
  verse dentro (en su sala de la rutina) — y cruzar la puerta visiblemente
  como hace el jugador. También la vida familiar dentro de casa
  (socializar con la familia en el salón) — pedido del streamer, se
  diseña con el hito de interiores.
- Hablar (F) con el NPC que pasa por delante: `npc:hablar` ya existe en
  el Hub; conectar el id del agente al gestor de conversaciones cuando
  el diálogo IA salga de su pausa (decisión del streamer: aparcado).
- Animación de andar del rig del NPC sincronizada con VIAJANDO (el rig ya
  anda para jugadores; pasar el flag).
- Burro y carreta del melonero (composición agente+animal+prop) — arte y
  mecánica futuros; de momento el melonero va a pie con su pregón.
- Sentarse de verdad (pose del rig) para "pedir_sentado"/bancos — hoy el
  NPC se queda de pie en el sitio; la pose llega con las animaciones.
