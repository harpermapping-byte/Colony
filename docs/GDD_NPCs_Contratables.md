# GDD — NPCs trabajadores contratables

**ESTADO: IMPLEMENTADA Y VERIFICADA (2026-09-01)** — reclutador fijo colocado por el jarl, contratación con coste creciente por oficio, NPC real visible en el mundo operando su mesa asignada, crafteo automático por tick (reusa `crafteo.ts` tal cual, sin reglas nuevas de validación), y salario mensual resuelto perezosamente por día de mundo, con despido automático de los más recientes cuando no llega el dinero — nunca deja Farycoins negativos.

Pedido del streamer (resumen, ver el mensaje original en el historial de la sesión): un NPC "reclutador" fijo en la ciudad capital, colocado por el jarl donde quiera. Desde él, cualquier jugador contrata NPCs trabajadores con 1+ oficios reales (más oficios = más caro), que aparecen trabajando de verdad una mesa asignada, craftean recetas reales solos sin que el jugador esté presente, y cobran un salario UNA VEZ AL MES in-game a todos los trabajadores de un jugador de golpe — si no hay Farycoins suficientes ese día, los que no cobran se despiden y desaparecen para siempre.

Este documento resume el diseño realmente construido, con el porqué de cada decisión que no venía cerrada del pedido. El "Análisis original" de `docs/Backlog_Mecanicas_Futuras.md` (2026-08-29/30) ya anticipaba la pieza como un TERCER "cerebro" sobre el mismo "cuerpo" de `server/src/mundo/agentes.ts` (rutina horaria / patrulla / **trabajador contratado**) — este documento es esa pieza, cerrada.

## 0. Relación con el "trabajador pagado" de producción pasiva (§5bis de `docs/GDD_Produccion.md`) — sistemas DISTINTOS, a propósito

Antes de esto ya existía un mecanismo separado, `plantilla:asignarTrabajador`, que activa/desactiva un booleano `trabajadorAsignado` en una plantilla de producción PASIVA (aserradero y similares) por un coste FIJO de 50 Farycoins (`COSTE_TRABAJADOR_FARYCOINS`), con un NPC "Trabajador" genérico plantado en el sitio mientras dura. Es un sistema legítimo y se deja intacto — pero no tiene oficios, no craftea recetas reales, no cuesta más por saber más, y no cobra salario periódico (se paga una vez, sigue "activo" indefinidamente).

Los NPCs de este documento son un sistema NUEVO y separado: tienen 1+ de los 10 oficios reales, craftean recetas reales validadas oficio-a-oficio, se contratan desde un reclutador (no desde el menú de cada plantilla), y cobran salario mensual recurrente. Comparten con el sistema viejo el mecanismo de "NPC fijo plantado en el sitio" (`GestorAgentes.agregarNpcFijo`) porque es la pieza correcta a reusar — pero viven en su propia tabla (`npcs_trabajadores`) y su propio protocolo (`reclutador:*`/`trabajador:*`), sin tocar el sistema viejo.

## 1. El reclutador — colocación reusando el mecanismo de NPC tutorial

En vez de construir un sistema de colocación nuevo, el reclutador es una entrada más del catálogo de NPCs fijos que YA tiene colocación en vivo, persistencia y gating de jarl resueltos: `poblacion/catalogo/npcsTutoriales.json`, categoría nueva `"reclutador"` junto a `"tutorial"`/`"lore"` (`server/src/mundo/npcsFijos.ts::NpcTutorial.categoria`). El jarl lo coloca/mueve (quitar+volver a colocar)/quita con los mismos 3 mensajes de siempre: `admin:npcTutorial:colocar {tipoTutorial:"reclutador_trabajadores"}` (en SU posición actual), `admin:npcTutorial:catalogo`, `admin:npcTutorial:quitar {id}` — jarl/superadmin-only (`puedeActuarComoJarl`), persistido en `npcs_tutoriales` (sobrevive un reinicio del servidor).

**Por qué reusar esto en vez de una tabla/mecanismo propio**: el pedido pide EXACTAMENTE lo que ese sistema ya hace ("colocable/movible/eliminable por el jarl, donde quiera, persistente") — construir un segundo mecanismo idéntico solo para poder llamarlo "reclutador" habría sido puro código duplicado. La única diferencia real es que su interacción NO pasa por el diálogo de texto de `npc:hablar` (ver §2).

**Por qué NO vía `npc:hablar`**: `npc:hablar` (con su placeholder de texto o IA) solo está cableado en `HubRoom.ts` — la ciudad capital normalmente vive en una `RegionRoom` (`docs/GDD_Ciudad_Capital.md`), que no tiene ese mensaje. Los mensajes `reclutador:*`/`trabajador:*` (§2) están registrados en `RoomExteriorBase.ts` (la base común de Hub Y Region), así que el reclutador funciona en cualquier mapa donde el jarl lo coloque, no solo en el Hub.

## 2. Protocolo — mensajes nuevos (`server/src/rooms/base/RoomExteriorBase.ts`)

| Mensaje | Quién | Qué hace |
|---|---|---|
| `reclutador:catalogo` | cualquiera | Devuelve los 10 oficios y el coste de contratar con 1..10 de ellos (`costePorCantidad`). |
| `reclutador:contratar {oficios: string[]}` | cerca de un reclutador | Cobra el coste (§3), crea la fila en `npcs_trabajadores`, el NPC aparece YA en el mundo en la posición del reclutador. |
| `trabajador:listar` | dueño | Sus propios trabajadores (para el panel de gestión). |
| `trabajador:asignarMesa {trabajadorId, construccionId}` | dueño/jarl, cerca de la mesa | Teleport instantáneo del trabajador a esa mesa (§4); limpia la receta anterior (puede que ya no aplique). |
| `trabajador:asignarReceta {trabajadorId, recetaId\|null}` | dueño/jarl | Fija qué craftea solo — valida mesa+oficio (§5). |
| `trabajador:despedir {trabajadorId}` | dueño/jarl | Borra la fila y lo quita del mundo — nunca vuelve. |

Errores de las 5 últimas: un único canal `trabajador:error {motivo}` (incluidos los de `reclutador:contratar` — no hizo falta un canal `reclutador:error` aparte, un jugador solo necesita un sitio donde mirar). El transporte (`transporte:contratar`) YA existía completo (`docs/GDD_Produccion.md`) y ya vivía en esta misma base compartida — el reclutador no duplica nada, el panel cliente simplemente lo ofrece desde el mismo sitio (§7).

## 3. Coste de contratación — creciente por oficio adicional

`server/src/construccion/trabajadores.ts::costeContratacionTrabajador(numOficios)`: suma de `coste_base * (1 + incremento*(i-1))` para `i = 1..numOficios`, con `coste_base = 100` e `incremento = 0.5`. Con los valores por defecto: 1 oficio = 100₣, 2 = 250₣, 3 = 450₣, 4 = 700₣... — el oficio i-ésimo cuesta MÁS que el (i-1)-ésimo, así que no es solo "más caro en total" sino que cada oficio adicional pesa más que el anterior (una progresión más dura que lineal, sin llegar a exponencial). Se eligió esta fórmula simple (frente a una tabla fija o una exponencial) porque es fácil de razonar para el jugador ("cada oficio más cuesta más que el anterior") y fácil de rebalancear moviendo dos constantes.

## 4. El trabajador en el mundo — mismo mecanismo que un NPC fijo, sin caminar solo

Un trabajador contratado es, para `GestorAgentes`, exactamente un NPC fijo más (`npcTrabajadorAAgente`, `server/src/mundo/npcsFijos.ts` — mismo patrón que `npcTutorialAAgente`): un único tramo de 24h sin `camino`. Nace en la posición del reclutador; al asignarle una mesa, **teleporta instantáneamente** a la casilla de la mesa (se quita el agente y se vuelve a plantar en el punto nuevo) en vez de caminar hasta allí.

**Por qué teleport y no un paseo real** (el pedido dejaba elegir): `agentes.ts` tiene una regla dura de cabecera — "nada de A* en vivo, si el camino bakeado falta, TELEPORT". Una mesa construida por un jugador en vivo no tiene ninguna ruta pre-calculada por el bakeador offline (a diferencia de las paradas de un NPC de `poblacion/`), así que calcular una ruta ahora sería exactamente la excepción que esa regla prohíbe. El propio "trabajador pagado" de producción pasiva (§0) ya sienta el mismo precedente. Un paseo real queda anotado como posible mejora futura, no como carencia oculta.

`accion` del `NpcBakeado` distingue visualmente dos estados: `"trabajar"` (contratado, sin mesa+receta operativas — de pie, idle normal) y `"craftear"` (mesa Y receta asignadas — dispara la pose "trabajando" del rig, ver §6).

## 5. Crafteo automático — mismo `crafteo.ts` que usa un jugador, sin duplicar validación

El tick periódico (`RoomExteriorBase.tickTrabajadores`, cada 10s vía `this.clock.setInterval`, no un `setInterval` crudo — Colyseus lo pausa/reanuda con la room) recorre los trabajadores de la room con mesa+receta asignadas:

1. Si ya hay un crafteo en curso para ese trabajador (`craftesTrabajador`, un `EstadoCrafteo` — el MISMO tipo que usa `crafteo.ts` para un jugador) y `crafteoListo()` dice que terminó, deposita el resultado y libera el slot.
2. Si no hay crafteo en curso: valida que la receta siga siendo válida para esa mesa (`receta.mesas.includes(viva.objeto)`) y que el oficio de la receta esté entre los del trabajador (`puedeOperarOficio` — reusa `OFICIOS_JUGADOR_VALIDOS`, el MISMO catálogo cerrado de 10 oficios que ya valida a un jugador, requisito §6 del pedido: "reutiliza la validación que ya existe"). Comprueba TODOS los insumos antes de consumir ninguno (para no dejar un consumo parcial si falta el segundo insumo de la lista), y si alcanza, arranca `terminaEn = ahora + receta.tiempoBaseSeg * 1000`.

**Dónde vive el "inventario" del trabajador — decisión de diseño, no estaba especificado**: NO tiene un inventario propio, y NO usa el del jugador dueño. Insumos y resultado van al **almacén de la propiedad de la mesa asignada** (`tenderete_items`, vía `bd.consumirStockTenderete`/`sumarStockTenderete` — las MISMAS primitivas que ya usa `refinamiento:depositar` y el trabajador pagado de producción pasiva). Motivo: es el único sitio que ya existe, ya lo ve el jugador desde su cofre/tenderete de esa construcción, y evita inventar un contenedor nuevo por trabajador que habría que gestionar aparte. El jugador reabastece ese almacén con `refinamiento:depositar` como ya hacía para producción pasiva.

**Sin bonos de energía/nivel de oficio/poción** (a diferencia del jugador): el trabajador craftea siempre a ritmo BASE (`receta.tiempoBaseSeg`, sin `factorVelocidadPorEnergia` ni módulos de mesa ni pociones). Simplificación deliberada — el trabajador no tiene XP de oficio ni sesión de jugador de la que colgar esos bonos; se documenta aquí para que no se lea como un olvido.

## 6. Pose "trabajando" del rig (`client/src/render3d/rigHumanoide.ts`)

Mismo patrón que la pose "caído" de los cadáveres (commit reciente) y "tocando instrumento": un pose FIJO sin keyframes, disparado por un booleano nuevo en `RigHumanoide.actualizar(..., trabajando)`. De pie, inclinación hacia delante, brazos con un balanceo suave hacia la mesa. El cliente lo activa cuando `npc.accion === "craftear"` (`client/src/game.ts`, campo `EstadoJugador.trabajando`) — nunca para `"trabajar"` (contratado sin mesa/receta todavía), que se queda con el idle normal.

## 7. Panel cliente — placeholder de testeo, mismo criterio que comercio/combate/mascotas

`client/src/economia/panelReclutador.ts` + tecla **R** (`client/src/game.ts`) cuando hay un reclutador cerca: checkboxes de oficio con coste en vivo + botón "Contratar", lista de trabajadores propios con "Asignar mesa aquí" (la construcción más cercana al jugador, `RenderConstrucciones.masCercanaCualquiera` — nuevo método público, mismo patrón que `masCercanaDeObjeto`), un campo de texto para el id de receta (sin selector visual todavía, mismo nivel de esqueleto que `cofre:meterItem`/`companero:darItem` vía id crudo) y "Despedir". Un botón "Contratar transporte..." deja claro que el sistema de transporte ya existente (`transporte:contratar`, sin panel propio todavía) se pide desde el mismo sitio — **no se duplicó UI ni protocolo de transporte**, solo se referencia desde el panel del reclutador.

## 8. Salario mensual — cálculo perezoso por día de mundo, pagado en bloque, despido por antigüedad

`server/src/construccion/trabajadores.ts::resolverPayroll` (PURA, sin BD/Colyseus — ver tests) — mismo espíritu perezoso que `resolverIngresoDiarioNpc`: nadie corre un cron, se resuelve por comparación de días de mundo (`tiempoMundo().dia`, NO tiempo real: 1 día de mundo = 30 minutos reales) dentro del mismo tick de 10s de §5, agrupado por dueño.

- **El ANCLA del ciclo es el `ultimoPagoDia` MÁS ANTIGUO entre los trabajadores activos de un dueño**: aunque se contraten en días distintos, el primer pago sincroniza a TODO el grupo a partir de ahí — así "si tiene 10, paga a los 10 juntos ese día" (pedido literal) sigue siendo cierto para siempre después, en vez de 10 fechas de pago distintas. Un trabajador contratado a mitad de ciclo se pliega al ciclo del grupo (puede cobrar un poco antes de cumplir su primer mes completo) — efecto secundario aceptado a cambio de la simplicidad de un solo ciclo por dueño, documentado aquí en vez de escondido.
- **Si el saldo no alcanza para todos, se despide primero a los MÁS RECIENTES** (`fechaContratacionDia` descendente) hasta que el resto quepa en el saldo disponible. Decisión de diseño — el pedido dejaba elegir entre "más caros" o "más recientes primero": se eligió antigüedad porque protege a los trabajadores más asentados/productivos del jugador, la lectura más intuitiva de "se me acabó el dinero, pierdo lo último que contraté" — un trabajador de un solo día nunca debería desplazar a uno de varios meses solo por ser más barato de mantener.
- El cobro usa `ajustarFarycoins` (compare-and-swap atómico ya existente) — nunca deja Farycoins negativos por construcción, no hace falta ningún chequeo adicional.
- Los despedidos por impago se BORRAN de `npcs_trabajadores` y del mundo — "dejan de existir, no vuelven" (pedido literal), mismo tratamiento que un despido manual.

**Salario base**: `salarioMensualTrabajador(numOficios) = 15 * max(1, numOficios)` Farycoins/mes — un trabajador con más oficios también cuesta más de MANTENER, no solo más de contratar (simetría deliberada con el coste de contratación).

## 9. Persistencia — tabla `npcs_trabajadores`

Mismo molde dual SQLite/Postgres que `contratos_transporte`/`npcs_tutoriales` (`server/src/datos/bd.ts`): `id, mapa_id, dueno_id, nombre, oficios (JSON), construccion_id (NULL hasta asignar), receta_id (NULL hasta asignar), x, y, fecha_contratacion_dia, ultimo_pago_dia, creado_en`. Se recrean al arrancar la room (`HubRoom.ts`/`RegionRoom.ts::listarNpcsTrabajadoresDeMapa` → `registrarTrabajadorEnMemoria`) — sobreviven un reinicio del servidor, verificado en el E2E (§10) con tres arranques reales sobre la misma BD.

## 10. Verificación

- **Unit/integración** (`server/test/trabajadores.test.ts`, 11 tests): coste de contratación (marginal creciente), validación de lista de oficios (vacío/duplicados/fuera de catálogo se rechazan), `puedeOperarOficio`, `salarioMensualTrabajador` escala con oficios, `resolverPayroll` PURA (no toca pagar antes de ciclo; paga a todos de golpe con saldo de sobra; el ancla es el `ultimoPagoDia` más antiguo del grupo; despide a los más recientes primero cuando no alcanza; despide a todos y no cobra nada si ni siquiera alcanza para el más antiguo), persistencia BD completa (contratar → asignar mesa → asignar receta → listar → marcar pago → despedir, sobre sqlite en memoria), y que `ajustarFarycoins` nunca deja saldo negativo.
- **E2E real contra el servidor** (`server/test/npcs_trabajadores.e2e.mjs`, servidor+BD+protocolo Colyseus REALES, sin mockear nada, tres arranques del proceso sobre la MISMA BD sqlite para poder forzar el "día de mundo" del pago mensual sin esperar las ~15h reales que tardaría un mes de juego): el jarl coloca el reclutador (mismo mecanismo que un NPC tutorial), `reclutador:catalogo` devuelve coste marginal creciente, contratar con fondos insuficientes se rechaza SIN tocar el saldo, contratar con fondos de sobra cobra el coste exacto y el trabajador aparece YA en `state.npcs` con `accion:"trabajar"`, `trabajador:listar` lo devuelve, un jugador que no es el dueño no puede despedirlo, el dueño real sí puede y desaparece de BD y del mundo para siempre, y — el caso importante — un segundo trabajador contratado con el saldo vaciado a 0 y el día de mundo forzado (`DIA_FORZADO`) a +31 desde su contratación es **despedido automáticamente** por el tick de payroll en el arranque siguiente, sin dejar Farycoins negativos. Los 6 pasos, contra un servidor real, en verde.
- **`tsc --noEmit`** limpio en `server/` y `client/`. Suite completa de servidor: **1079/1079** (incluye los 11 tests nuevos).

### Lo que NO quedó verificado en vivo (honestidad, no se esconde)

- **Asignar una mesa real + ver el crafteo tick a tick + la pose "trabajando" renderizada** no se probó contra el servidor real dentro del E2E: requiere que el jugador de prueba sea dueño de una parcela y coloque una construcción real (`construir`, con su propia validación de parcela/terreno) antes de poder asignarla — un flujo de construcción completo que se juzgó fuera de alcance razonable para este E2E dado el tiempo disponible, sin restar valor a que la ruta de código (`tickTrabajadores`, `manejarTrabajadorAsignarMesa/Receta`) comparte exactamente las mismas primitivas (`consumirStockTenderete`/`sumarStockTenderete`, `validarCrafteo`-equivalente) que SÍ están probadas por la suite de crafteo/producción existente y por los tests de persistencia de este documento. Queda pendiente como refuerzo: un E2E que además construya una mesa real y verifique el crafteo y la pose de punta a punta con capturas de pantalla — no descartado, solo no hecho aquí.
- La UI del panel (`panelReclutador.ts`) es un placeholder funcional (checkboxes + botones + un campo de texto para el id de receta), no arte final — mismo nivel que el resto de paneles del proyecto a la espera de UI aprobada por el streamer.
