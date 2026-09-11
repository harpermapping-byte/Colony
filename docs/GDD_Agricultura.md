# GDD — Agricultura

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30), §4 REHECHA el mismo día siguiendo el diseño ya cerrado del backlog.** Piezas: `server/src/cultivo/cultivo.ts` (puro: niveles de agua/fertilizante, siembra por mes, cosecha, mezcla de rasgos de injerto), `server/src/inventario/inventario.ts` (+tipo `"semilla"`, `DatosCultivo`, `RasgosCultivo`, `abreEn`), `server/src/construccion/catalogo.ts` (+campo `plantable`), `server/src/datos/bd.ts` (tabla `cultivos_hibridos`, dual SQLite/Postgres), `server/src/rooms/base/RoomExteriorBase.ts` (mensajes `cultivo:*` + `objeto:abrir` + `injerto:crear`), `items/catalogo/items.json` (14 ítems nuevos: fertilizante, 4 cultivos base, 4 semillas base con `rasgos`, 4 bolsas), `interiores/catalogo/exteriores.json` (`bancal_cultivo` marcado plantable + 3 macetas + `mesa_injertos`), cliente `client/src/agricultura/panelCultivo.ts` + `panelInjerto.ts` + `client/src/construccion/renderConstrucciones.ts` (tinte del suelo) + `client/src/game.ts`. Probado: `server/test/cultivo.test.ts` (32 tests) + `server/test/cultivosHibridosBd.test.ts` (4 tests nuevos), suite completa de servidor 486/486, suite de interiores 34/34, `tsc --noEmit` limpio en `server/` y `client/`, `combate.e2e.mjs` en verde.

Pedido del streamer (2026-08-30, resumen — texto completo en el historial): plantar en suelo labrado o macetas de varios tamaños; agua y fertilizante 0-100 por parcela, el suelo se ve más claro cuanto más bajos están (oscuro = bien regado/abonado); semillas por especie del mundo (15% al recolectar una planta salvaje, si no comprando bolsas de 10 en tienda); siembra por meses según la variedad, tiempos cortos (no como Farming Simulator de verdad); algunas especies se cosechan y siguen dando fruto, otras se pierden enteras al cosechar (asignado por especie, como en la vida real); y un sistema de injertos/esquejes como profesión propia (como desuello o herrería) para crear híbridos nuevos — "si no sabes algo, revisa otros juegos de referencia e investiga y decide tú".

## 1. Labrar y macetas (`EntradaConstruible.plantable`)

**Interpretación explícita**: en este proyecto "construir" ya es la única forma de colocar algo en una parcela (`docs/GDD_Construccion.md`) — así que **construir el `bancal_cultivo` ES labrar la tierra**: no hay un verbo "labrar" aparte, el bancal nace listo para plantar en el momento en que se coloca. Cuatro construibles nuevos en `exteriores.json`, todos con el nuevo campo `plantable: { multiplicadorCosecha }`:

| id | huella | multiplicador | uso |
|---|---|---|---|
| `bancal_cultivo` | 3×2, pisable | 1× | tierra labrada de verdad, ya existía sin lógica |
| `maceta_pequena` | 1×1 | 1× | maceta básica |
| `maceta_mediana` | 1×1 | 1.5× | rinde más |
| `maceta_grande` | 2×1 | 2× | jardinera, la de mayor rendimiento |

Cada instancia colocada guarda como mucho **UNA planta a la vez** (mismo modelo que colmena/trampa_pesca — "una construcción, una cosa" — nunca una rejilla de celdas independientes dentro del mismo bancal, decisión de scope explícita).

## 2. Agua y fertilizante — sin tick, derivados del calendario (`cultivo/cultivo.ts`)

Ni el agua ni el fertilizante se guardan como número: se **derivan** de `tiempoMundo().dia` (día de MUNDO entero) contra el día del último riego/abonado, exactamente igual que el resto del proyecto deriva stock/desgaste de un timestamp en vez de mantenerlo al día con un tick de fondo ("cálculo perezoso", CLAUDE.md regla 1):

- `nivelAgua = max(0, 100 − 25 × díasDesdeElÚltimoRiego)` — de 100 a 0 en 4 días de mundo sin regar.
- `nivelFertilizante = max(0, 100 − 12 × díasDesdeElÚltimoAbonado)` — aguanta más, ~8 días.

Regar (`cultivo:regar`) y abonar (`cultivo:abonar`, consume 1 `fertilizante` del inventario) simplemente ponen el día actual como "último riego/abonado" — el número sube a 100 y decae solo desde ahí. El **crecimiento en sí corre por calendario** (`díasCrecidos = díaActual − díaPlantado`), no día a día "¿se regó exactamente hoy?" — simplificación deliberada frente a un tick diario real: mientras haya agua > 0 EN EL MOMENTO de cosechar, la cosecha sale a tiempo; dejar la tierra seca mucho tiempo solo bloquea la cosecha (no la retrasa en el calendario), y el color del suelo (§5) avisa visualmente antes de que llegue a pasar.

## 3. Semillas y cosecha (`DatosCultivo`, en `items.json`)

Nuevo tipo de ítem `"semilla"` con un bloque `cultivo` (itemIdCosecha, diasCrecimiento, mesesSiembra, cosechaRecurrente, cantidadPorCosecha). Cuatro cultivos base, elegidos para cubrir los dos casos reales que pidió el streamer:

| semilla | cosecha | días | meses | recurrente | por qué |
|---|---|---|---|---|---|
| `semilla_trigo` | `trigo` | 3 | mar-may | **no** | un cereal se siega entero |
| `semilla_zanahoria` | `zanahoria` | 4 | feb-abr, sep-oct | **no** | una raíz se arranca entera |
| `semilla_tomate` | `tomate` | 5 | abr-jun | **sí** | la mata sigue dando fruto |
| `semilla_fresa` | `fresa` | 4 | mar-may, sep | **sí** | la planta sigue produciendo |

`cultivo:plantar {construccionId, instanciaId}` exige que `tiempoMundo().mes` esté en `mesesSiembra` de la semilla — fuera de temporada se rechaza. Sembrar riega de golpe (tierra recién trabajada = húmeda) pero NO abona (el fertilizante es un extra, requiere el ítem aparte). `cultivo:cosechar` da `cantidadPorCosecha × multiplicadorMaceta`, +50% si el fertilizante está al 50% o más en ese instante; si `cosechaRecurrente`, la parcela sigue con la misma semilla (reinicia el contador de días); si no, queda vacía para volver a plantar.

### Semillas del mundo (15%) y bolsas de tienda

**Pendiente de wiring, documentado como el único hueco real de esta v1** (ver §6): el "coger" de recolectables salvajes hoy no tiene ningún gancho de "15% de dar también una semilla" — añadirlo exige tocar `manejarCoger`/`intentarCoger`, deliberadamente dejado para no acoplar agricultura al pipeline de recolección salvaje en esta primera pasada. Lo que SÍ está completo: comprar una **bolsa** (`bolsa_semillas_trigo/zanahoria/tomate/fresa`, tenderete normal, `tenderete:comprar` ya existente) y abrirla con el nuevo mensaje genérico `objeto:abrir {instanciaId}` — consume 1 bolsa, da 10 unidades de la semilla correspondiente (campo `abreEn` en el catálogo, reusable para cualquier futuro "paquete de N", no solo semillas).

## 4. Injertos y esquejes — el diseño YA CERRADO del backlog, construido tal cual

**Primera versión (misma tarde) usaba recetas fijas de crafteo — SUSTITUIDA por esto**, tras confirmar con el streamer que quería el diseño que ya estaba cerrado en `docs/Backlog_Mecanicas_Futuras.md` ("Injertos y cruces de cultivos"): combinación **abierta** (cualquier semilla con cualquier otra, sin receta predefinida), 6 rasgos numéricos 0-1 por especie, cruce = media de los dos padres + variación aleatoria, resultado registrado como **especie nueva y permanente**.

### 4.1 Los 6 rasgos (`RasgosCultivo`, en el bloque `cultivo` de cada semilla)

`rendimiento` · `calidad` · `resistenciaEnfermedad` · `velocidadCrecimiento` · `necesidadAgua` · `tamanoFruto` — TODA semilla los lleva, base o híbrida, porque cualquier par es combinable. Solo `rendimiento` (escala `cantidadPorCosecha`) y `velocidadCrecimiento` (escala `diasCrecimiento`) tienen efecto mecánico en esta v1; el resto queda como dato de sabor/futuro consumidor (precio, enfermedades...) — mismo criterio "SIN CONSUMIDOR" ya aceptado en otros catálogos del proyecto.

### 4.2 Injertar (`injerto:crear {construccionId, instanciaIdA, instanciaIdB}`)

En una `mesa_injertos` (construible nuevo, sin dueño — taller compartido, igual que cualquier mesa de crafteo), con nivel 1+ de oficio `"botanica"` (mismo mecanismo de XP que cualquier otro oficio — `bd.obtenerXpOficio`/`sumarXpOficio`, la "exclusividad de profesión" que pedía el streamer es la MISMA que ya exige XP de herrero para forjar). Cualquier par de semillas del inventario, consumidas al injertar:

- **Rasgos**: `mezclarRasgos` — cada uno de los 6 = media de los dos padres ± hasta 0.12 de variación aleatoria, acotado a [0,1] ("no genética mendeliana compleja", pedido explícito del diseño cerrado).
- **Mecánica de cultivo derivada** (`derivarCrecimientoHibrido` — el diseño cerrado NO la especificaba, quedaba "pendiente"): `diasCrecimiento` = media de los padres modulada por `velocidadCrecimiento`; `mesesSiembra` = UNIÓN de los meses de ambos padres (más versátil, coherente con "fomenta que se combinen"); `cosechaRecurrente` = true si CUALQUIERA de los padres lo es; `cantidadPorCosecha` = media modulada por `rendimiento`.
- **Nombre automático**: `"Híbrido {A}×{B}"` a partir de los itemId de los padres (ej. "Híbrido Semilla Tomate×Semilla Fresa") — renombrable a mano en cualquier momento (`renombrarCultivoHibrido` en BD, sin UI todavía, ver §6).
- **Color placeholder**: media RGB de los `colorDebug` de los dos padres.
- **Permanencia**: se persiste en la tabla `cultivos_hibridos` (dual SQLite/Postgres) — sobrevive a un reinicio del servidor. Cada room funde las especies ya creadas en su copia en memoria del catálogo de ítems la primera vez que las necesita (`asegurarHibridosCargados`, perezoso, una vez por vida de la room).
- El jugador se lleva 2 unidades de la semilla híbrida resultante para poder plantarla, y XP de botánica.

### 4.3 Decisión explícita sobre "qué pasa si falla" (pendiente en el diseño cerrado)

El diseño original marcaba como abierto "probabilidad de éxito del injerto, qué pasa si falla". Se resolvió así: **no hay fallo** — cualquier injerto válido (mesa correcta, nivel de oficio, dos semillas de verdad) siempre produce una especie nueva; la "aleatoriedad" vive solo en los rasgos resultantes (§4.2), no en si el injerto prospera. Repetir el mismo par de padres genera una especie DISTINTA cada vez (nuevo id, variación propia) — no hay caché "combo ya existe, reusar" — coherente con que un injerto real nunca sale exactamente igual dos veces.

## 5. Suelo visual (0-100 → color)

Servidor: `cultivo:estado` manda `agua`/`fertilizante` ya resueltos (0-100) cada vez que algo cambia (plantar/regar/abonar/cosechar) o se consulta (`cultivo:consultar`, al acercarse). Cliente (`RenderConstrucciones.tintarSuelo`): interpola la tapa de la caja placeholder entre marrón muy clarito (`#c9b48a`, agua+fertilizante a 0) y tierra oscura (`#241a10`, ambos a 100) según `(agua+fertilizante)/200` — exactamente el criterio pedido ("si baja el suelo se pone más claro"). Placeholder de caja (mismo arte pendiente que el resto del proyecto) pero el TINTE es de verdad, no cosmético fijo.

## 6. Cliente (placeholder) y huecos documentados

`panelCultivo.ts` (mismo criterio placeholder que combate/mascotas/comercio/pesca): aparece solo al acercarse a un bancal/maceta (`RenderConstrucciones.plantableMasCercana`, auto-apuntado por proximidad, sin tecla dedicada — los botones ya mandan `cultivo:*`), muestra agua/fertilizante/días restantes y botones plantar (por id de instancia, sin rejilla arrastrable — fase 3 de inventario sigue pendiente)/regar/abonar/cosechar. `panelInjerto.ts` — mismo criterio, aparece junto a una `mesa_injertos` (`RenderConstrucciones.deObjetoMasCercana`), dos campos de id de instancia + botón "Injertar".

**Huecos explícitos de esta v1** (a decidir con el streamer si se cierran ahora o más adelante):
- El 15% de semilla al recolectar del mundo salvaje NO está enganchado todavía (§3) — es el único punto donde "revisa otros juegos" se quedó en diseño sin implementar, para no tocar el pipeline de recolección salvaje en esta misma pasada.
- Solo 4 cultivos base — el catálogo real de partida (más especies) es contenido a añadir después; los híbridos, en cambio, ya son ilimitados por diseño (§4).
- `objeto:abrir` no tiene todavía un disparador de UI (botón/clic) porque no existe rejilla de inventario arrastrable — el mensaje de servidor está listo y probado, a la espera de la fase 3 de inventario.
- `renombrarCultivoHibrido` (BD) no tiene todavía ningún mensaje/UI que lo dispare — el "renombrar a mano" del diseño cerrado está listo en persistencia, sin cablear al cliente.
- Una especie híbrida creada en una room DURANTE su vida no se propaga a otras rooms ya en marcha hasta que esas rooms la necesiten y la carguen de BD (`asegurarHibridosCargados` es perezoso, no hay broadcast entre rooms) — aceptable para un servidor de un solo proceso con pocas rooms activas a la vez.

## 7. Agricultura por CASILLA — segunda agricultura en paralelo (propuesta 2026-09-04, ver `docs/GDD_Carros.md` §9)

Pedido del streamer: además de esta agricultura de construcción (§1, el bancal/maceta ES el labrado), habrá una segunda agricultura totalmente distinta — labrar suelo abierto directamente con azada (a mano) o con arado de tiro montado (automatizado, tirado por cualquier animal montable), sembrar y cosechar en la propia casilla en vez de en una construcción con huella fija. Corrige explícitamente la frase de §1 ("no hay un verbo 'labrar' aparte") — SÍ lo habrá, pero como sistema nuevo y paralelo, no como cambio sobre este. Diseño completo (mensajes `cultivoCasilla:labrar/plantar/cosechar`, persistencia dual SQLite/Postgres en `casillas_cultivo`, reutiliza el mismo catálogo `DatosCultivo` de semillas de este documento) en `docs/GDD_Carros.md` §9 — **sin implementar todavía**, documento de propuesta pendiente del OK antes de programarse.

## 8. Agricultura de casilla JUGABLE: menú del suelo + casillas replicadas y visibles (2026-09-11)

La agricultura de casilla (§7, `cultivoCasilla:labrar/plantar/cosechar`, `docs/GDD_Carros.md` §9) estaba implementada y probada SOLO por protocolo: ningún cliente mandaba esos mensajes y ninguna casilla labrada/sembrada se replicaba — un jugador no podía labrar desde el navegador ni ver un campo sembrado por nadie (ni el suyo). Cerrado:
- **`CasillaCultivoSchema` replicado** (`HubState.cultivosCasilla`, clave = idx de casilla como string): `x, y, estado ("labrada"|"sembrada"), semillaId, diaPlantado`. El Map del servidor (`casillasCultivo`, caché por mapa + BD) sigue siendo la fuente de verdad; `sincronizarCasillaCultivo(idx)` espeja cada mutación (labrar/plantar/cosechar manuales y por apero) y la hidratación completa al crear la room. No lleva `@view()` (una granja real son decenas/cientos de losas estáticas, no miles de entidades móviles).
- **Render** (`client/src/agricultura/renderCultivoCasillas.ts`, NUEVO): losa marrón a ras de suelo para labrada; sembrada = losa + brote de dos planos cruzados cuya altura sigue el porcentaje REAL de maduración (`(diaMundo - diaPlantado) / diasCrecimiento` del catálogo público `items.json`, la misma regla que usa el servidor para aceptar cosechar) — maduro se pinta dorado, así el jugador ve cuándo cosechar en vez de probar a ciegas. Geometrías/materiales compartidos, un Object3D ligero por casilla, reconstruido solo cuando cambia su tramo visual (estado o cuarto de crecimiento), reevaluado cada 5s.
- **Menú del suelo** (`game.ts`, clic sin mueble debajo): la casilla exacta sale de cortar el rayo del clic con el plano y=0 (1 casilla = 1 unidad de mundo) — "Suelo (x,y)": `Labrar aquí (azada)` si no hay nada; `Plantar <semilla> (n)` por cada semilla real del inventario (`items.json::cultivo`) si está labrada; `Cosechar` si está sembrada (título = el cultivo). El servidor sigue validando todo (parcela propia/jarl, azada equipada, temporada, madurez); los rechazos llegan como toast legible (`ERRORES_CULTIVO`, p.ej. "Todavía no está madura.").
- Sondas de test: `window.__cultivo.casillas()/casillaEn(x,y)`, `window.__inventario()`.

**Verificación**: `client/test/playtestOficios.e2e.mjs` paso 6 — en verde: la casilla (27,10) sembrada en BD antes de arrancar llega replicada al cliente (`estado:"sembrada"`, `semillaId:"semilla_trigo"`, brote maduro); con la azada equipada, clic real en el suelo (26,10) → "Labrar aquí (azada)" → `cultivoCasilla:labrada {26,10}` y la casilla aparece replicada como labrada; segundo clic → "Plantar Semilla de trigo (2)" → `cultivoCasilla:plantada`; clic sobre la madura → "Cosechar" → `cultivoCasilla:cosechada {trigo ×3}` y 3 trigo en el inventario. Captura `client/test/capturas/playtest_oficios_cultivo.png` (losa a los pies del jugador). `server/test/cultivoCasilla.e2e.mjs` (protocolo, testflat) sigue 11/11.

**Pendiente**: el menú del suelo vive en el bloque Hub de `game.ts` (misma restricción que el resto de clics sobre construcciones): en una `RegionRoom` con parcelas (capital_jarl) todavía no se ofrece; el brote es genérico (mismo aspecto para trigo/zanahoria/…), sin arte por cultivo.

## 9. Tierra para macetas, pala y riego con agua de verdad (2026-09-11)

Pedido literal del streamer al ver `maceta_pequena`/`maceta_grande` en el panel de construcción: *"estas macetas, que habrá que crear alguna más, se tienen que llenar con tierra (la pala en el suelo click, sacar tierra) se puede sacar una por cuadradito de suelo de tierra, se va al inventario, tiene peso y tal, y con eso se llena la maceta (click maceta meter tierra) y ahí se podría plantar plantas y crecen aunque estén en interior, necesita regarse (espero que tengamos cubo o regadera, llenar agua y click sobre planta, regar)"*. Hasta hoy una maceta se sembraba directamente y regar era gratis (un clic sin gastar nada).

### 9.1 Tierra (`tierra`, ítem nuevo) y la pala (`suelo:cavar {x,y}`)
- `pala` (herramienta, `manoPrincipal`, receta de herrero nivel 1 en el yunque: 1 lingote de hierro + 1 madera blanda; `.glb` propio en `assets/herramientas/pala_01.glb`, arquetipo HACHA del taller como la azada) EQUIPADA — mismo criterio que la azada para labrar.
- Una palada = 1 `tierra` (recurso, 1.5 kg, pila de 10) por casilla de suelo de TIERRA (`medioEn === TIPO.TIERRA`: nunca agua/roca), sin construcción encima y no labrada. **Sin exigir parcela a propósito** (como coger bayas, no como labrar): la tierra es un recurso del mundo, no una obra. Cae a la mochila o al suelo si no cabe (`entregarOSoltar`), con la animación de "picar" para todos (`accion:jugador`).
- "Una por cuadradito": `RoomExteriorBase.casillasCavadas` (casilla → día de mundo) bloquea la misma casilla durante `DIAS_REGENERACION_TIERRA=3` días. Solo en memoria, decisión consciente: un reinicio "asienta" el suelo y con 1.5 kg por unidad frente a 20 kg de carga el abuso posible no merece una tabla nueva.
- Cliente: menú del suelo (clic en el terreno) → **"Cavar tierra (pala)"**, junto a "Labrar aquí (azada)"; `suelo:cavado`/`suelo:error` como toast.

### 9.2 Llenar la maceta (`cultivo:meterTierra {construccionId}`) y sembrar
- Campo ADITIVO opcional `plantable.tierraNecesaria` (`interiores/catalogo/exteriores.json`, tipos de `catalogo.ts`): `maceta_pequena`/`maceta_mediana` 1, `maceta_grande` 2, y las dos NUEVAS (pedido "habrá que crear alguna más") `jardinera_madera` (carpintero nivel 2, 2×1, ×2.5, 2 de tierra) y `tiesto_piedra` (picapedrero nivel 2, 1×1, ×1.8, 1 de tierra) — estas dos con `requiereItemColocar` como el mobiliario del carpintero (`docs/GDD_Construccion.md` §9); las tres de barro siguen gratis. El **bancal** no lleva el campo: ya es tierra labrada, sigue igual. (`tiesto` y no `maceta_piedra` a propósito: en este catálogo `maceta_piedra` es el MAZO del picapedrero.)
- `EstadoCultivo.tierra` cuenta las unidades metidas (una por llamada, consume 1 `tierra` de la mochila; "ya está llena" al completar). `cultivo:plantar` rechaza con `falta tierra: mete N más` mientras `tierraQueFalta > 0` (`cultivo/cultivo.ts`, puro). **La tierra se queda en la maceta**: plantar y cosechar conservan `estado.tierra` — el e2e cazó que la primera versión de plantar la perdía (construía el estado desde cero).
- `cultivo:estado` lleva ahora `tierra`/`tierraNecesaria`; el panel de cultivo muestra "🪴 Tierra n/N" + botón **Meter tierra**, y no ofrece plantar hasta completarla. De paso el panel dejó de pedir un id de instancia a mano: **desplegable con las semillas que llevas** (mismo recorrido que el menú del suelo). Una maceta sin su tierra se pinta GRIS (`tintarSuelo`), para distinguir "falta tierra" de "falta regar".
- "Crecen aunque estén en interior": el crecimiento va por días de mundo (`tiempoMundo().dia`), no por dónde esté la maceta — pero HOY no se puede construir dentro de un interior (`InteriorRoom` no tiene `ctxConstruccion`), así que en la práctica las macetas viven en parcelas exteriores. Construir dentro de la casa es una pieza aparte, sin abrir.

### 9.3 Regar gasta agua (`cultivo:regar`)
- Hace falta un recipiente con agua en la mochila (`tieneLiquido(it,"agua")`, `docs/GDD_Inventario.md` §9): `cantimplora` (500 ml), `cubo_madera` (2000 ml) o la **`regadera` NUEVA** (objeto, 3000 ml, herrero nivel 2: 2 lingotes de hierro). Cada riego consume `ML_POR_RIEGO=500` (1/4/6 riegos por llenado), auto-apuntando al que más agua lleve; sin agua → `necesitas un cubo o una regadera con agua`.
- Los recipientes se llenan junto a un río/lago con `recipiente:llenar` (ya existía) — **pero ningún jugador podía llenar nada hasta hoy**: el mensaje solo lo mandaban los tests. `panelJugador.ts` gana en cada recipiente el botón **Llenar** (vacío) / **Beber** (con agua), y `recipiente:llenado`/`bebido`/`error` salen como toast.

### 9.4 Verificación
- `server/test/cultivoTierra.test.ts` (4): helpers puros, catálogo (toda maceta exige tierra, el bancal no, las nuevas se colocan con su ítem), riegos enteros por recipiente.
- `server/test/macetaTierraRiego.e2e.mjs` (23/23, colyseus.js puro sobre testflat, día forzado 60 para poder sembrar trigo, cubo sembrado en BD con 500 ml): maceta gratis pero "falta tierra" al sembrar; cavar sin pala / con la pala sin equipar se rechaza; equipada da 1 tierra, la misma casilla no repite, bajo una construcción no se cava, la de al lado sí; meter tierra 1/1 y "ya está llena"; siembra con `tierra` conservada; regar vacía el cubo (500→0) y el segundo riego pide agua; llenar lejos del agua se rechaza; la jardinera exige su ítem, pide 2 y con 1 sigue pidiendo "mete 1 más".
- `server/test/coherenciaCatalogo.test.ts` (12) sin regresión: `tierra` registrada como fuente en código, los 4 ítems/recetas nuevos pasan nombre/valor/XP por fórmula (`valorBase.js --aplicar`, `VALOR_CRUDO.tierra=1`). `tsc --noEmit` limpio en cliente y servidor.
- **Pendiente real**: sin verificación visual en navegador del panel nuevo ni del menú "Cavar tierra" (solo protocolo); la fauna doméstica/NPC trabajador no riegan por su cuenta (nunca lo hicieron); regadera/tierra sin `.glb` en expositores (caen a la caja de color, `docs/GDD_Construccion.md` §9.7).

