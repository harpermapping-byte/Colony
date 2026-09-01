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
