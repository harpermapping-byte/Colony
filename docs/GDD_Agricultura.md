# GDD — Agricultura

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30).** Piezas: `server/src/cultivo/cultivo.ts` (nuevo, puro: niveles de agua/fertilizante, siembra por mes, cosecha), `server/src/inventario/inventario.ts` (+tipo `"semilla"`, `DatosCultivo`, `abreEn`), `server/src/construccion/catalogo.ts` (+campo `plantable`), `server/src/rooms/base/RoomExteriorBase.ts` (mensajes `cultivo:*` + `objeto:abrir`), `items/catalogo/items.json` (17 ítems nuevos: fertilizante, 4 cultivos base + 2 híbridos, 6 semillas, 4 bolsas), `items/catalogo/recetas.json` (2 recetas de injerto, oficio `botanica`), `interiores/catalogo/exteriores.json` (`bancal_cultivo` marcado plantable + 3 macetas + `mesa_injertos`), cliente `client/src/agricultura/panelCultivo.ts` + `client/src/construccion/renderConstrucciones.ts` (tinte del suelo) + `client/src/game.ts`. Probado: `server/test/cultivo.test.ts` (10 tests nuevos), suite completa de servidor 471/471, suite de interiores 34/34, `tsc --noEmit` limpio en `server/` y `client/`, `combate.e2e.mjs` y `construccion.e2e.cjs` en verde.

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

## 4. Injertos y esquejes — profesión "botánica" (`items/catalogo/recetas.json`)

**Reusa el sistema de crafteo YA existente entero, cero código de servidor nuevo** — un injerto es, mecánicamente, una receta de crafteo más: mesa (`mesa_injertos`, exterior nuevo), oficio (`"botanica"`, un string más de los que ya acepta `RecetaCrafteo.oficio`), nivel mínimo, insumos (dos semillas) y resultado (una semilla híbrida). Exactamente el mismo mecanismo que restringe el yunque al herrero (XP de oficio vía `bd.obtenerXpOficio`/`nivelDeXp`, `validarCrafteo` en `crafteo.ts`) — la "exclusividad de profesión" que pedía el streamer para injertar es la MISMA que ya exige XP de herrero para forjar, sin inventar un mecanismo aparte.

Dos recetas de ejemplo (el árbol completo de combinaciones es contenido, no mecanismo — se añade con más entradas de catálogo cuando el streamer quiera, "las listas crecen, el código no"):

- `injerto_tomate_fresa` (nivel 1): `semilla_tomate` + `semilla_fresa` → `semilla_hibrida_tomate_fresa` → cultivo `fruto_hibrido_tomate_fresa`, 6 días, recurrente.
- `injerto_trigo_zanahoria` (nivel 2): `semilla_trigo` + `semilla_zanahoria` → `semilla_hibrida_trigo_zanahoria` → cultivo `fruto_hibrido_trigo_zanahoria`, 6 días, cosecha única.

## 5. Suelo visual (0-100 → color)

Servidor: `cultivo:estado` manda `agua`/`fertilizante` ya resueltos (0-100) cada vez que algo cambia (plantar/regar/abonar/cosechar) o se consulta (`cultivo:consultar`, al acercarse). Cliente (`RenderConstrucciones.tintarSuelo`): interpola la tapa de la caja placeholder entre marrón muy clarito (`#c9b48a`, agua+fertilizante a 0) y tierra oscura (`#241a10`, ambos a 100) según `(agua+fertilizante)/200` — exactamente el criterio pedido ("si baja el suelo se pone más claro"). Placeholder de caja (mismo arte pendiente que el resto del proyecto) pero el TINTE es de verdad, no cosmético fijo.

## 6. Cliente (placeholder) y huecos documentados

`panelCultivo.ts` (mismo criterio placeholder que combate/mascotas/comercio/pesca): aparece solo al acercarse a un bancal/maceta (`RenderConstrucciones.plantableMasCercana`, auto-apuntado por proximidad, sin tecla dedicada — los botones ya mandan `cultivo:*`), muestra agua/fertilizante/días restantes y botones plantar (por id de instancia, sin rejilla arrastrable — fase 3 de inventario sigue pendiente)/regar/abonar/cosechar.

**Huecos explícitos de esta v1** (a decidir con el streamer si se cierran ahora o más adelante):
- El 15% de semilla al recolectar del mundo salvaje NO está enganchado todavía (§3) — es el único punto donde "revisa otros juegos" se quedó en diseño sin implementar, para no tocar el pipeline de recolección salvaje en esta misma pasada.
- Solo 4 cultivos base + 2 híbridos de ejemplo — el catálogo real (más especies, más combinaciones de injerto) es contenido a añadir después, no una limitación del mecanismo.
- `objeto:abrir` no tiene todavía un disparador de UI (botón/clic) porque no existe rejilla de inventario arrastrable — el mensaje de servidor está listo y probado, a la espera de la fase 3 de inventario.
