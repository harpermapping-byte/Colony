# GDD — Barcos y navegación marítima

**ESTADO: v1 IMPLEMENTADA (2026-08-30).** Pedido del streamer, mismo mensaje
que destapó Monturas: *"Barcos y navegación marítima: solo se pueden
construir en el taller de barcos (que es un edificio especial del jarl) y
con profesión nivel alto de carpintería... los barcos son objetos que
también se bakearán como muebles y tal, y tendrán el concepto de montura
pero en el agua, se unen el jugador al barco y va montado a más velocidad
SOLO por agua, no puede acceder a otro tipo de suelo. Habrá varios barcos,
el de 1 persona, el de 2, el de 3 y el de 4 inicialmente (tendrán asientos
cada uno para el número de personas y tamaño, en alargado, o sea crecen en
tamaño cada modelo a lo largo y añadiendo alguna vela más o remos. Se podrá
viajar a otros mapas exteriores si el borde es mar y llegas al final saldrá
opción de viajar a (siguiente mapa nombre) y viajas al siguiente instancia
mapa exterior cuando lo haya."*

## 1. El Taller de Barcos

`interiores/catalogo/tipos_edificio.json:astillero` YA existía (tema
`carpintero_ribera`, sala "taller" con `mesa_calafateo`+`banco_carpintero_ribera`,
ambas `isMandatory:true`) pero sin `construible` — nadie podía levantarlo.
Esta pasada lo convierte en el "Taller de Barcos" del pedido: `construible:
true, proyectoJarl: true` (proyecto especial 14/14, el último que quedaba
por `construible` — completa la lista, tope 1 por asentamiento,
solo el jarl, solo en parcela `tipo:"especial"` — mismo mecanismo que
`capitania_puerto`/`gran_archivo`, ver `docs/GDD_Construccion.md` §1bis).
`capitania_puerto` (el otro edificio que ya apuntaba a "Barcos y navegación
marítima" en su nota) se deja intacto — es la oficina administrativa de
puerto/pesca, un edificio DISTINTO, sigue "sin diseñar".

La profesión: `carpintero_ribera` ya era un oficio planeado
(`docs/GDD_Profesiones.md`, ligado a `astillero`) — se exige nivel 5 de 6
("nivel alto", escala existente de `server/src/progresion/nivel.ts`). No se
añade ninguna otra profesión encima — el pedido dejaba la elección abierta
("y no sé si alguna más... lo dejo a tu elección") y no hay nada más que
aporte aquí.

**El gate real** no es "estar de pie en una mesa concreta" (esa mesa es una
pieza de `elementos.json` como cualquier otra, técnicamente colocable en
cualquier sitio vía "construir" — limitación preexistente, ninguna pieza de
mueble hoy comprueba desde qué edificio salió) sino un campo NUEVO en la
receta: `RecetaCrafteo.edificioRequerido` (`server/src/construccion/
crafteo.ts`) — el asentamiento actual debe tener un `astillero` construido
de verdad (comprobado en `manejarCrafteoIniciar`, mismo `ctx.vivas` que ya
usa la regla "1 por asentamiento" de `construccion.ts`). Sin el edificio
del jarl levantado, ninguna receta de barco se puede intentar aunque el
jugador tenga la mesa y el nivel.

## 2. Los 4 barcos

`items/catalogo/items.json` — 4 ítems nuevos (`tipo:"objeto"`, como
`silla_montar`: no se equipan), con dos campos nuevos: `esBarco: true` +
`plazas` + `velocidadBarco` (casillas/seg, SOLO sobre agua):

| Ítem | Plazas | velocidadBarco | huella (crece a lo largo) |
|---|---|---|---|
| `barco_1` | 1 | 6.0 | 3×1 |
| `barco_2` | 2 | 6.5 | 4×1 |
| `barco_3` | 3 | 7.0 | 5×1 |
| `barco_4` | 4 | 7.5 | 6×1 |

`items/catalogo/recetas.json` — 4 recetas (`barco_1_construido`..`barco_4_construido`),
`oficio: "carpintero_ribera"`, `nivelMinimo: 5`, `edificioRequerido:
"astillero"`, `mesas: ["mesa_calafateo","banco_carpintero_ribera"]`
(ambas ya nacen con el astillero), insumos crecientes de `madera_dura` +
`clavos` + `tela_hilada` (velas), `tiempoBaseSeg` de 60 a 150.

`taller-vox/generar_barco.js` (nuevo): lee `esBarco`/`huella`/`plazas`
directo de `items.json` (cero catálogo duplicado) y genera un casco tallado
a proa/popa con borda, cubierta, 1 mástil+vela hasta 2 plazas y 2 a partir
de 3 (más vela por talla, pedido literal), y un remo por plaza a cada
banda. **NO se ha exportado/subido ningún `.glb`** — a diferencia de
edificios/muebles (que sí tienen autorización propia del streamer para
saltarse la revisión pieza a pieza, ver `taller-vox/exportar_lote.js`), los
barcos no la tienen: `node generar_barco.js` deja `barcos_generados.json`
listo para revisar en el visor y exportar cuando el streamer lo apruebe.
Mientras tanto el cliente pinta un casco placeholder con la huella real
(`client/src/render3d/barcoVisual.ts`, mismo criterio que
`animalPlaceholder.ts` de Monturas).

## 3. Colocar

`barco:colocar` (tecla **J**): consume del inventario un ítem `esBarco`
(cualquiera, no hace falta que sea el más cercano — solo hay uno por
slot), exige agua a `RADIO_INTERACCION` (`casillaAguaCercana`), y lo ancla
ahí como fila nueva en la tabla `barcos` (BD) + entidad `Barco` en
`state.barcos`. A diferencia de una mascota, un barco **nunca vuelve al
inventario**: una vez colocado vive en el mundo (mapa_id+x+y) hasta que
alguien lo mueva pilotándolo.

## 4. Montar/pilotar — fusión multi-plaza

`barco:montar` (tecla **P**, toggle con `barco:desmontar` según
`Player.barcoId`): auto-apunta al barco con hueco libre más cercano
(`RADIO_INTERACCION`, cualquiera puede embarcar, no solo el dueño — varias
plazas para viajar en grupo). El **primero en subir pilota** (capitán,
`Player.barcoCapitan=true`); el resto son pasajeros que se mueven CON el
barco. A diferencia de una montura animal (que fusiona jugador+mascota en
UNA entidad y la mascota desaparece del Schema), un barco **sigue siempre
visible** en `state.barcos` — con varias plazas no tiene sentido fusionarlo
con un solo jugador. El cliente solo oculta el rig humanoide de cada
ocupante (`barcoId>0`) — el casco ya se pinta aparte.

Si el capitán se baja con pasajeros a bordo, el siguiente en la lista pasa
a pilotar automáticamente (`RoomExteriorBase.desembarcarSesionId`); si se
baja el último, el barco ancla su posición actual en BD.

**Movimiento** (`actualizarMovimiento`): el input del capitán mueve el
barco a `velocidadBarco` (sin multiplicador de terreno — no tiene sentido
sobre agua, sin sprint/estamina, "no es el jugador quien se mueve", mismo
criterio que una montura animal). **"Solo por agua, no puede acceder a
otro tipo de suelo"** (pedido literal): si el destino de un tick deja de
ser agua, el barco simplemente no se mueve ese tick — nunca queda varado a
medias en la orilla. Los pasajeros se sincronizan a la posición del barco
con un pequeño offset por asiento, en una pasada aparte DESPUÉS de
`separarPJs` para que nunca resbalen fuera de la cubierta por el empuje
PJ-PJ. Un barco tampoco bucea (nivel siempre 0, "nadando").

## 5. Combate

Mismo criterio que Monturas ("si entra en combate no aparece la montura ni
el PJ montado") **salvo en combate ACUÁTICO** (orca/tiburón — pedido aparte
2026-08-30, ver `docs/GDD_Combate.md §9.6`): ahí el capitán se ve EN el
barco y el resto de la tripulación nadando, puramente cosmético, "no da más
bonus ni nada". El funnel único de entrada a combate sigue desembarcando a
TODOS antes de mandarlos a la arena (`desembarcarSesionId`/`desmontarSesionId`
— el barco se ancla de verdad donde estaba, exactamente igual que en
combate normal); la diferencia es que `cerrarVentanaCombate` toma una
instantánea de "quién iba en qué barco" ANTES de ese desembarco y la manda
a la arena como dato puramente visual (`CombateUnidad.visual`/`barcoTipoId`).

## 6. Navegación entre mapas exteriores

El campo `bordes` de `indice.json` (norte/sur/este/oeste, `{tipo, nombre}`)
YA existía en el esquema del bakeador (`baker/config/ejemplo-bordes.json`)
pero **ningún código del servidor lo leía** — esta pasada es la primera que
lo consume: `mapaColision.ts:MapaCargado.bordes`, cargado por HubRoom en
`bordesMapa`.

Cruzar un borde reusa la MISMA tecla que cualquier puerta (**F**, mismo
criterio "sin UI de targeting/confirmación" que el resto del juego — el
pedido decía "saldrá opción de viajar", no un diálogo de confirmación): el
servidor mira si el capitán está pegado a un borde con `tipo:"mar_abierto"`
y `nombre` apuntando a un mapa que YA existe en disco
(`assets/mapas/<nombre>/indice.json`) y, si es así, ancla el barco ahí en
BD y manda `portal:ir {tipo:"hub", mapaId}` a todos los ocupantes — cada
cliente recarga a su cuenta, exactamente como cualquier otro portal.

`server/src/index.ts` registra una SEGUNDA definición de `HubRoom`,
`"hub_mapa"` (con `filterBy(["mapaId"])`), para no tocar el `"hub"` de
siempre (que sigue sin options, cero riesgo). `HubRoom.onCreate(options?:
{mapaId})` resuelve `assets/mapas/<mapaId>` cuando se manda; sin él, el
comportamiento de siempre (`rutaMapaHub()`).

**Simplificación documentada**: solo el barco (dueño de la fila BD) viaja
garantizado — al llegar, el jugador aparece a pie en el mapa nuevo (sin
re-embarcar automático) y el barco reaparece anclado donde el capitán lo
dejó, listo para volver a subir. Un pasajero también recibe el `portal:ir`
(no se queda tirado solo en el mapa viejo) pero tampoco reaparece
automáticamente embarcado.

Como hoy solo existe `assets/mapas/principal/` en producción (su propio
`bordes` sigue con los 4 `nombre:null` que ya traía el bake — sin tocar),
el mecanismo queda **inerte hasta que el streamer baquee un segundo mapa
exterior y rellene `bordes` en ambos índices apuntándose entre sí**. Para
probarlo de punta a punta sin depender de eso, esta pasada generó DOS
mapas de prueba mínimos y 100% agua (`assets/mapas/test_mar_a`/
`test_mar_b`, `baker/src/generar_mapas_prueba_barcos.js` — bake pequeño de
prueba, no de producción) que sí se cruzan entre sí de verdad en el E2E.

## 7. Verificación

- **Tests puros nuevos**: `cargarCatalogoBarcos`
  (`server/test/catalogoBarcos.test.ts`), persistencia de `barcos`
  (`crearBarco`/`listarBarcosDe`/`actualizarPosicionBarco`,
  `server/test/barcosBd.test.ts`).
- **`server/test/barcos.e2e.mjs`** (nuevo, servidor Colyseus real): siembra
  un barco YA colocado en `test_mar_a`, confirma que aparece en
  `state.barcos`, que `barco:montar` fusiona al capitán SIN quitar el
  barco del Schema, que pilotarlo cruza 16 casillas de agua a velocidad
  real, que `mapa:viajarVecino` en el borde este manda
  `portal:ir {tipo:"hub", mapaId:"test_mar_b"}`, y que uniéndose de verdad
  a `hub_mapa`/`test_mar_b` el barco reaparece anclado ahí (BD
  `mapa_id` cambiado) con el jugador llegando a pie.
- **Suite completa de servidor: 638/638** (630 + 4 nuevos de barcos + 4
  nuevos de combate acuático — `seleccionArena`/`catalogoCombateFauna` — + 2
  ajustes a tests existentes por el recuento de items.json). `tsc --noEmit`
  limpio en `server/` y `client/`. Build de producción (`vite build`)
  verificado.
- **`taller-vox/generar_barco.js`** verificado exportando los 4 modelos a
  `.glb` en un scratchpad temporal (no en `assets/`) — geometría válida,
  vóxeles/triángulos escalando con la talla.
- **No verificado visualmente en un navegador real** (mismo límite ya
  aceptado para Monturas/equipo/interiores en esta fase) — el render 3D
  solo hasta "compila, bundlea y el casco cuelga en su sitio según el código".

## 8. Explícitamente descartado / fuera de alcance de este pase

- **Figura de los ocupantes visible sobre el barco** — mismo criterio que
  Monturas: hoy solo se oculta el rig, no se pinta ninguna figura sentada.
- **`.glb` real de los 4 barcos subido a `assets/`** — generador listo,
  pendiente de que el streamer lo revise en el visor (sin autorización
  propia para saltarse ese paso, a diferencia de edificios/muebles).
- **Vida/daño de un barco** — no lo pedía el mensaje original (ese sí
  hablaba de "no tiene vida" para las monturas; para barcos no se dijo
  nada, se mantiene el mismo criterio por consistencia).
- **Bake de un segundo mapa exterior de PRODUCCIÓN** — los agentes solo
  hacen bakes pequeños de prueba (CLAUDE.md); el mecanismo de cruce está
  listo y probado con mapas de prueba, pero `assets/mapas/principal/`
  sigue con un único mapa hasta que el streamer decida bakear el
  siguiente y configure `bordes` en ambos.
- **Rellenar `bordes` de `assets/mapas/principal/`** — sus 4 `nombre:null`
  se dejan tal cual (no hay a qué apuntar todavía).
- **Robo/permiso de "solo el dueño monta su barco"** — se decidió abierto
  (cualquiera puede embarcar si hay hueco), matching el espíritu "viajar
  en grupo" de tener varias plazas; no lo pedía el mensaje original pero
  tampoco lo prohibía, y restringirlo habría sido una regla extra sin pedir.
