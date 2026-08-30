# GDD — Monturas (domesticación/control de movimiento)

**ESTADO: v1 IMPLEMENTADA (2026-08-30).** Pedido del streamer: *"las monturas
(caballo vaca yegua, jabalí, cerdo, ciervo y si se te ocurre alguno más de
animales implementados lo pones) pueden ser montados si se les añade objeto
MONTURA que aparecerá en su lomo... esto hará que te puedas montar en él con
tecla. Y ahora la montura y el PJ son uno solo, aumentando velocidad ya que
asume la velocidad del animal... si entrara en combate no aparece la montura
ni el PJ montado, es solo para moverse más rápido y saltar nada más. Para
domesticarlos será como el resto de animales, se les debe dar comida X
cantidad de veces y la comida que ellos suelan comer... te seguirá como el
perro para montarlo y si no, lo mandas a casa. No tiene vida de momento."*
El diseño CORE (fusión en una sola entidad, pivote de silla derivado de
proporciones, `montable` como flag por especie) ya estaba acordado con el
streamer desde el 2026-08-27 en `docs/GDD_Mecanicas.md` — esta pasada lo
implementa y añade lo pedido encima (silla como ítem, salto, ocultar en
combate).

Aclaración pedida aparte en el mismo mensaje ("Barcos y navegación
marítima"): sin ningún detalle dado — se deja **fuera de esta pasada**,
sigue "sin diseñar" en `docs/Backlog_Mecanicas_Futuras.md`.

## 1. Qué especies son montura

`personajes/catalogo/animales_rig.json` — nuevo campo `montable: true` +
`velocidadMontura` (casillas/seg) por especie, exactamente como ya preveía
`docs/GDD_Mecanicas.md`: *"montable es un flag por especie, no por
plantilla — el burro sí, el conejo no, aunque compartan esqueleto"*.

| Especie | Ya tenía rig | velocidadMontura | Nota |
|---|---|---|---|
| `caballo` | sí | 8.5 | urbano/aldea |
| `caballo_salvaje` | **nueva entrada** | 8.5 | exterior/Hub, mismas proporciones que `caballo` |
| `vaca_salvaje` | sí | 5 | cubre "vaca" del pedido |
| `burro` | sí | 6 | bonus — es el propio ejemplo canónico del GDD acordado |
| `jabali` | **nueva entrada** | 6.5 | |
| `cerdo` | **nueva entrada** | 4.5 | la más lenta, con gracia |
| `ciervo` | sí | 8 | |

**Simplificaciones deliberadas, documentadas para que el streamer pueda
pedir más si quiere:**
- **"Yegua"** no es una entrada de rig aparte — el sistema no modela sexo
  como una especie distinta a efectos de monta; domesticar/montar un
  `caballo`/`caballo_salvaje` cubre el pedido. Añadir una `yegua` con rig
  propio es trivial (mismo patrón que `caballo_salvaje` de esta pasada) si
  se pide expresamente.
- `buey` (bovino de tiro, ya en catálogo) se dejó FUERA a propósito — su
  propia nota en `animales_rig.json` ya decía *"animal de tiro, no de
  monta"*, una decisión de otro pase que este respeta.
- `docs/GDD_Mascotas.md §1` ya decía: *"el campo `domesticable` ya está
  listo para cualquier especie futura... sin tocar código"* — se cumplió:
  jabalí y ciervo solo necesitaron `domesticable:true` en
  `baker/catalogo/animales.json` (antes `false`), cero código nuevo de
  domesticación.

## 2. "Que los que ya aparecen en aldeas también aparezcan en exteriores"

Pedido explícito de seguimiento del streamer, tras preguntarle qué hacer con
jabalí/ciervo (que solo existían como fauna SALVAJE del Hub, nunca en
aldeas — el único sitio con domesticación hasta ahora). Su respuesta invirtió
la pregunta: quiere que la fauna de ALDEA (caballo/vaca/cerdo/burro/buey) se
pueda encontrar TAMBIÉN suelta en el exterior salvaje, para poder
domesticarla ahí igual que en el pueblo.

- `caballo`/`vaca` ya tenían su par `_salvaje` con hábitat real
  (`caballo_salvaje`/`vaca_salvaje`, bioma `pradera`) — no hacía falta tocar
  nada, ya salen sueltos en el Hub.
- `cerdo` (antes `biomas: []`, `densidadBase: 0`, fauna urbana pura) — se le
  dio hábitat real (`pradera`+`bosque`, densidad baja) en
  `baker/catalogo/animales.json`. **Requiere rehornear el mapa exterior
  para verse en el mundo real** (el bakeado grande lo corre el streamer,
  CLAUDE.md) — el cambio de catálogo ya está hecho y probado.
- `burro`/`buey` se dejaron con `biomas: []` tal cual (no se pidieron
  explícitamente como "quiero verlos sueltos", y no son parte del pedido de
  monturas salvo `burro` como bonus montable-en-aldea).

### Domesticar en el Hub (fauna salvaje) — pieza que faltaba

`docs/GDD_Mascotas.md` solo cableaba "dar de comer" en `RegionRoom` (fauna
urbana, `GestorFauna`). El Hub tiene su PROPIO gestor de fauna viva
(`GestorFaunaSalvaje`, sectores bajo demanda) con una interfaz distinta —
esta pasada:

- **`GestorFaunaSalvaje.domesticar(id)`** (`server/src/mundo/
  faunaSalvajeViva.ts`) — método COMPARTIDO con `docs/GDD_Ganaderia.md`
  (fusionado al mezclar ambas pasadas en paralelo: los dos pedidos
  necesitaban exactamente lo mismo — quitar un individuo de la fauna
  salvaje viva SIN matarlo, para que se convierta en otra cosa, un
  `AnimalGranja` allí o una mascota/montura aquí). DISTINTO de
  `matarIndividuo`: marca la fila `estado: "muerto"` (mismo valor que la
  muerte real — el único chequeo real que existe sobre `estado`,
  `faunaSalvajeSector.ts: vivo = estado==="vivo"`, ya trata cualquier valor
  que no sea `"vivo"` como no-vivo, así que reusarlo no rompe nada) pero
  **nunca crea cadáver** — un ciervo que se convierte en mascota no debe
  dejar un cuerpo looteable en su sitio. Devuelve la especie domesticada.
- **`HubRoom.ts`**: nuevo `onMessage("mascota:darComida", ...)` — mismo
  auto-apuntado por `RADIO_INTERACCION` que `RegionRoom`, pero contra
  `state.fauna`/`gestorFaunaSalvaje` del Hub.

### Comida diet-aware (antes: cualquier `comidaMascota` valía para cualquiera)

`docs/GDD_Mascotas.md §2` solo marcó carnes/pescados como `comidaMascota` —
correcto para perro/gato (carnívoros), pero un caballo herbívoro podía
"comer" carne cruda para domesticarse, lo cual no tenía sentido pedido ahora
explícitamente ("la comida que ellos suelan comer"). Arreglado sin romper lo
existente:

- `EstadisticasCombateAnimal.dieta` (nuevo campo,
  `server/src/mundo/catalogoCombateFauna.ts`) — passthrough de
  `baker/catalogo/animales.json:dieta` (ya existía en el catálogo, sin
  consumidor).
- `comidaSirveParaDieta(entrada, dieta)` (pura, nueva,
  `server/src/inventario/inventario.ts`): carnívoro solo `origenCocina:
  "animal"`, herbívoro solo `"vegetal"`, omnívoro cualquiera de las dos; sin
  dato de dieta O sin `origenCocina` en el ítem = universal (nunca rompe por
  un dato ausente, mismo criterio que el resto del proyecto — cubre
  `racion_viaje`, que no tiene `origenCocina`).
- Nuevos ítems marcados `comidaMascota: true` para herbívoros/omnívoros:
  `baya`, `fruta`, `fruto_seco` (ya `origenCocina:"vegetal"`), `trigo`,
  `zanahoria` (cultivos de `docs/GDD_Agricultura.md`, mismo campo).
- **`manejarMascotaDarComidaGenerico`** (nuevo, movido a
  `RoomExteriorBase.ts` — antes vivía solo en `RegionRoom`): el núcleo
  compartido (comida diet-aware, progreso de domesticación en memoria,
  crear la mascota a las 5 veces) entre RegionRoom y HubRoom; cada Room solo
  aporta CÓMO encuentra y CÓMO quita a su candidato (closures pasadas como
  parámetro) — cero duplicación de la lógica de negocio.

## 3. La silla de montura (objeto nuevo)

Pedido literal: *"si se les añade objeto MONTURA que aparecerá en su
lomo"*. Es un ítem NUEVO (`silla_montar`, `items/catalogo/items.json`), NO
un slot de equipo del jugador — se usa SOBRE una mascota propia, no se
equipa uno mismo:

- `tipo: "objeto"`, campo nuevo `esMontura: true`
  (`EntradaCatalogoItem.esMontura`, `server/src/inventario/inventario.ts`).
- **`mascota:ponerMontura {mascotaId?}`** (nuevo mensaje,
  `RoomExteriorBase.ts`): auto-apunta a la mascota propia "siguiendo" más
  cercana (mismo criterio sin UI de targeting que darComida/coger, o usa el
  `mascotaId` explícito si el panel ya lo conoce) que sea de una especie
  `montable` de catálogo Y todavía sin silla; consume UN `esMontura` del
  inventario; marca `montura: true` **permanente** en BD
  (`bd.ponerMonturaMascota`, compare-and-swap por `jugadorId` como el resto
  de mutaciones de mascota) y en el Schema.
- **Receta** (`items/catalogo/recetas.json:silla_montar_curtida`): oficio
  curtidor, mesa `mesa_tenido_cuero` (misma que `mochila_cuero_curtido`),
  4× `cuero_curtido` + 1× `madera_dura` — así hay una forma real de
  conseguirla sin inventar un ítem sin origen.
- **Persistencia**: columna nueva `mascotas.montura` (SQLite `INTEGER
  DEFAULT 0` / Postgres `BOOLEAN DEFAULT FALSE`, migración `ALTER TABLE...
  IF NOT EXISTS` — mismo patrón que `ultimo_dia_actividad` de
  `jugador_atributos`). Sobrevive a desconexiones/cambios de room: la silla
  es un estado permanente de ESA mascota, no de la sesión.
- **Visible SIEMPRE que se ve a la mascota** (no solo montada) —
  `client/src/render3d/monturaVisual.ts` cuelga la silla del pivote `lomo`
  en cuanto `mascota.montura===true`, tanto si está "siguiendo" a pie como
  si se está montando.

## 4. Montar / desmontar — jugador y montura son UNA entidad

Diseño ya acordado en `docs/GDD_Mecanicas.md` ("Monturas acordado
2026-08-27"), implementado tal cual:

- **`mascota:montar {mascotaId?}`**: auto-apunta a la mascota propia
  "siguiendo" más cercana con `montura:true` (o usa el id explícito).
  Fusiona: la mascota **desaparece de `state.mascotas`**
  (`quitarMascotaDeSchemaLocal`, la misma función que ya usaba "dejar en
  propiedad" — la montura *"no tiene física propia"*, mismo criterio que ya
  fijó el GDD para la ropa) y `Player.monturaEspecieId`/`monturaMascotaId`
  se rellenan. El estado real de "quién monta qué, a qué velocidad" vive
  SOLO en memoria del servidor (`RoomExteriorBase.montadoPorSesion`, nunca
  en BD — desconectarse y volver a entrar simplemente devuelve la mascota a
  "siguiendo" a pie, sin nada que limpiar).
- **`mascota:desmontar`**: separa de nuevo — la mascota reaparece
  "siguiendo" justo en la posición del jugador (`desmontarSesionId`,
  reusado también por el auto-desmontar de combate, ver §6).
- **`actualizarMovimiento()`** (`RoomExteriorBase.ts`, el tick de
  movimiento de siempre): si `montadoPorSesion` tiene al jugador, la
  velocidad pasa a ser `velocidadMontura * modificadorDeTerreno` — **el
  mismo multiplicador de terreno del bakeador que `docs/
  Backlog_Mecanicas_Futuras.md` ya decía tener preparado desde el
  principio** ("una montura solo necesita su propio multiplicador aparte,
  sin tocar la tabla de terrenos"), cero tabla nueva. Sin sprint (Shift no
  hace nada montado — no es el jugador quien corre) ni gasto de estamina ni
  XP de Resistencia por moverse (sería XP gratis a caballo).
- **"Un caballo no bucea"** (regla ya fijada en el GDD acordado): montado,
  el nivel de profundidad se fuerza a 0 (superficie) — vadea el agua, nunca
  se sumerge.
- **Cliente — colgar del pivote, como la ropa** (regla ya fijada):
  `RigHumanoide` y `AnimalVoxel` comparten exactamente la misma forma
  (`{objeto, actualizar, orientar}`), así que `EstadoJugador.rig` puede
  apuntar a cualquiera de los dos sin tocar el bucle de interpolación/
  animación que ya trata jugadores/NPCs/fauna por igual
  (`client/src/game.ts:bucle`). Al montar: se crea el `AnimalVoxel` de la
  montura, se cuelga la silla, se OCULTA (no se destruye) el rig humanoide
  de siempre — conserva el equipo puesto intacto para cuando se desmonte —
  y `escena.añadirEntidad` se vuelve a llamar con el mismo `sessionId`
  (ya auto-limpia la entidad anterior). Al desmontar, vuelve tal cual.
  **Simplificación de esta pasada**: no se cuelga una figura del jinete
  sobre la montura (solo la silla es visible) — el streamer ve el caballo
  con su silla moviéndose en su sitio, no una figura humana sentada encima;
  añadir eso es "pose sentada rotando los pivotes de piernas del rig", ya
  previsto en el GDD acordado pero fuera de esta pasada por riesgo/tiempo
  (ver §7).

## 5. Salto

Pedido explícito, sin precedente en el proyecto (el motor de colisión es
"casillas + radios", sin verticalidad real — `docs/GDD_Mecanicas.md §1`).
Implementado como lo más simple que cumple *"solo es para moverse más
rápido y saltar nada más"*: **`montura:saltar {dx, dy}`** — solo hace algo
si está montado; mueve al jugador de golpe `DISTANCIA_SALTO_MONTURA=2.5`
casillas en la dirección indicada, SIN comprobar el camino intermedio (salta
por encima de un obstáculo corto — valla, muro bajo), pero rechaza el salto
entero si el punto de aterrizaje es sólido o cambia de medio (tierra↔agua —
no se salta AL agua). Cooldown de 3s (`COOLDOWN_SALTO_MONTURA_MS`) para que
no sea un dash infinito. Tecla **Espacio** en cliente, usando la última
dirección de movimiento no nula (por si se pulsa justo al soltar una tecla
de dirección).

## 6. Combate: nunca aparece la montura

Pedido literal: *"si entrara en combate no aparece la montura, ni el PJ
montado"*. Se engancha en `cerrarVentanaCombate` (`RoomExteriorBase.ts`) —
el ÚNICO punto por el que pasan TODOS los caminos de entrada a combate
(iniciar, unirse, auto-unión de fauna/enemigo hostil), justo antes de
mandar a cada jugador a la room de arena: `desmontarSesionId(p.id)`
desmonta automáticamente. Como cruzar a la arena es una conexión de
Colyseus nueva (recarga de página, confirmado investigando
`client/src/game.ts:navegarA`), el jugador nunca "lleva" el estado de
montura consigo — simplemente no vuelve a montarse hasta que lo pida de
nuevo al volver.

## 7. Verificación

- **Tests puros nuevos**: `comidaSirveParaDieta`
  (`server/test/inventario.test.ts`), `dieta`/domesticable de
  jabalí+ciervo+cerdo (`server/test/catalogoCombateFauna.test.ts`),
  `cargarCatalogoMonturas` (`server/test/catalogoMonturas.test.ts`, nuevo),
  `domesticar` (sin cadáver, `server/test/faunaSalvajeViva.test.ts`,
  reescritos sobre el método compartido con GDD_Ganaderia.md tras el
  merge), `ponerMonturaMascota`
  (roundtrip + compare-and-swap por dueño, `server/test/mascotasBd.test.ts`).
- **`server/test/monturas.e2e.mjs`** (nuevo, servidor Colyseus real sobre
  el mapa demo): siembra una mascota YA domesticada y con silla puesta,
  confirma que aparece con `montura:true` al entrar, que `mascota:montar`
  sin `mascotaId` (auto-apuntado) fusiona al jugador (la mascota sale de
  `state.mascotas`, `Player.monturaEspecieId` se rellena), que montado se
  mueve notablemente más rápido que a pie desde el MISMO punto exacto de
  spawn (sesión separada para controlar el terreno — el mapa demo no es
  uniforme), que `montura:saltar` mueve de golpe la distancia esperada, y
  que `mascota:desmontar` separa de nuevo.
- **Suite completa de servidor: 628/628** (tras fusionar con el trabajo en
  paralelo de Ganadería/Bosques/Caza, que tocó varios de los mismos
  archivos — ver nota de fusión en §2). `tsc --noEmit` limpio en `server/`
  y `client/`. Build de producción (`vite build`) verificado.
- **No verificado visualmente en un navegador real** (mismo límite ya
  aceptado para equipo/interiores en esta fase del proyecto) — el mecanismo
  de datos/servidor está probado a fondo con un E2E real de punta a punta;
  el render 3D solo hasta "compila, bundlea y las piezas cuelgan del pivote
  correcto según el código".

## 8. Explícitamente descartado / fuera de alcance de este pase

- **Figura del jinete visible sobre la montura** — hoy solo se ve la silla;
  el streamer ve un caballo moviéndose donde antes veía a su jugador. La
  "pose sentada" (rotar pivotes de piernas del rig humanoide) ya está en el
  GDD acordado como el plan, no implementada por riesgo de que la animación
  de marcha en curso pelee con la pose fija cada frame — necesita más
  cuidado del que daba tiempo en esta pasada.
- **Vóxel real del cuerpo del animal** (patas/cabeza/cola animadas) para
  mascotas Y monturas — hoy es una única caja placeholder por especie
  (`animalPlaceholder.ts`, con las proporciones reales del catálogo) en vez
  del vóxel completo que sí tiene la fauna PRE-horneada de cada mapa. Antes
  de esta pasada ni siquiera existía la caja (grupo vacío, invisible del
  todo) — mejora de paso, no el objetivo de esta feature. El vóxel completo
  necesitaría portar `personajes/src/generarAnimal.js` a TypeScript (mismo
  problema de interoperabilidad CommonJS/Rollup que ya se resolvió para el
  equipo del jugador, `docs/GDD_Equipo.md §4` — aquí sería un port bastante
  mayor, 7 plantillas de esqueleto en vez de una función pequeña).
- **"Yegua" como especie de rig independiente** — ver §1, cubierta por
  `caballo`/`caballo_salvaje` con esta simplificación documentada.
- **Radio de colisión propio por especie de montura** — usa `RADIO_PJ`
  (el mismo del jugador) en vez de uno derivado del tamaño real del animal;
  cuadra con "no tiene vida de momento" y no se pidió explícitamente.
- **Barcos y navegación marítima** — mencionado en el título del pedido
  original pero sin ningún detalle dado; sigue "sin diseñar" en
  `docs/Backlog_Mecanicas_Futuras.md`, pendiente de que el streamer lo
  concrete en un pase aparte.
- **Rehorneado del mapa exterior de producción** — el cambio de catálogo
  que hace que `cerdo` aparezca suelto en el exterior (§2) necesita que el
  streamer rehornee el mapa principal (los bakes grandes los corre él,
  CLAUDE.md) — el catálogo ya está listo, solo falta ese paso.
