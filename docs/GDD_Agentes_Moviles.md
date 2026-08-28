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

## Verificado (v1)

- Test de servidor del gestor: recolocación por hora al crear room,
  transición de tramo → VIAJANDO por el camino bakeado, llegada → QUIETO,
  teleport con camino ausente.
- E2E visual: región con población bakeada, NPCs pintados con su vox real
  moviéndose por las calles a la hora que les toca (hora forzada).

## Qué falta (pendiente, no bloquea)

- Cerebros de merodeo (fauna) y patrulla (bárbaros) — diseño cerrado
  arriba, llegan con sus mecánicas.
- NPCs dentro de interiores instanciados (hoy: visible=false al estar en
  casa/trabajo bajo techo).
- Hablar (F) con el NPC que pasa por delante: `npc:hablar` ya existe en
  el Hub; conectar el id del agente al gestor de conversaciones cuando
  el diálogo IA salga de su pausa (decisión del streamer: aparcado).
- Animación de andar del rig del NPC sincronizada con VIAJANDO (el rig ya
  anda para jugadores; pasar el flag).
