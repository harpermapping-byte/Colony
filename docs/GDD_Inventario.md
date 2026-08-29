# GDD — Inventario, Contenedores y Objetos en el Mundo

Fase 1 (pedido del streamer 2026-08-29): **catálogo + servidor + persistencia**, sin UI de cliente ni la mecánica de "coger del mundo" todavía — esas son las fases 2 y 3, ver §7. El concepto general ya estaba decidido en `docs/Backlog_Mecanicas_Futuras.md` ("Inventario, contenedores y objetos en el mundo"); este documento cierra el diseño concreto y es ahora el contrato, mismo criterio que `GDD_Construccion.md`.

## 0. Visión pactada (recordatorio, ya decidida antes de esta fase)

- Estilo Project Zomboid: rejilla 2D real ("tetris"), no una lista con cantidad.
- **Peso y espacio son EJES DISTINTOS**: todo objeto pesa (cuenta contra el peso transportable, ligado a Fuerza) Y ocupa una huella en la rejilla — independientes entre sí.
- Contenedores además del cuerpo (mochilas, bolsos) amplían la capacidad.
- Objetos soltados en el mundo se ven en su sitio real en 3D, no un icono — mismo concepto que los "objetos sueltos de superficie" que ya coloca `interiores/catalogo/elementos.json`.
- **Servidor autoritativo, cliente solo predice/muestra** — arquitectura ya fijada para inventario/equipo.

## 1. Catálogo de ítems (`items/catalogo/items.json`)

Módulo nuevo, hermano de `ropa/`/`personajes/` (offline, sin dependencias, mismo patrón de catálogo del proyecto). 55 entradas hoy:

- **49 recursos** (`tipo:"recurso"`), uno por cada `categoriaRecurso*` distinto que ya existe en `baker/catalogo/{vegetacion,animales,rocas}.json` (madera_dura, carne_roja, pescado_rio, hierro, oro, baya...) — el ÍTEM de inventario es la misma categoría que ya usa el bakeador para lo recolectable, no un catálogo duplicado. Agrupados en 7 "familias mecánicas" (metal/mineral_ligero/piedra/madera/planta/carne/piel) que comparten huella/peso/stackMax; el `colorDebug` sí es individual por recurso.
- **6 ítems ilustrativos no-recurso** (`tipo:"equipable"|"herramienta"|"consumible"`): `mochila_cuero`, `bolsa_cinturon` (contenedores equipables), `hacha_talar`, `pico_minero`, `antorcha_portatil` (herramientas), `racion_viaje` (consumible) — prueban esas ramas del schema. NO es un catálogo cerrado de armas/armaduras: crece después con el mismo patrón ("las listas CRECEN, el código no").

Campos de cada entrada: `tipo`, `categoriaRecurso?` (solo recursos), `slotEquipo?` (solo equipables/herramientas — nombre de slot, ver §4), `huella:[ancho,alto]` (casillas de rejilla), `peso` (número, eje independiente de la huella), `apilable`+`stackMax?`, `esContenedor?:{ancho,alto}` (solo ítems-mochila — su rejilla PROPIA al equiparse), `variantes`, `colorDebug` (placeholder, mismo criterio que el resto de catálogos — el `.glb` real se bakea más adelante).

## 2. Lógica de rejilla (`server/src/inventario/inventario.ts`)

**Pura** (sin Colyseus ni red — testeada sola, mismo patrón que `construccion.ts`/`mundo/colisiones.ts`, 15 tests):

- `Contenedor = {ancho, alto, items: ItemInstancia[], siguienteId}`. `ItemInstancia = {id, itemId, cantidad, x, y, rot}`.
- **Rotación: solo 0/1** (no 0/90/180/270) — en una rejilla de casillas cuadradas, 180°/270° dan la MISMA huella ocupada que 0°/90°, así que dos estados bastan y simplifican toda la comprobación de hueco.
- `hayHueco`: límites de la rejilla + solapamiento real con huellas rotadas de lo ya colocado (no un simple conteo de casillas libres).
- `buscarHueco`: primer hueco libre fila a fila — determinista, no aleatorio.
- `agregarItem`: si el ítem es apilable, primero rellena pilas YA existentes con hueco (hasta `stackMax`) antes de abrir una pila nueva; si no cabe todo, aplica lo que SÍ entró y devuelve `sin_hueco` — nunca falla en silencio ni a medias sin decirlo.
- `moverItem`: mismo contenedor (reposicionar/rotar, ignora la propia instancia al comprobar hueco) o entre DOS contenedores distintos (cuerpo → mochila) — todo o nada, si no cabe en destino el origen no se toca.
- `pesoContenedor`: suma `peso × cantidad` de cada pila — independiente de cuántas casillas ocupe.
- `pesoMaximoTransportable(fuerza)`: **fórmula PLACEHOLDER** (`20 + fuerza×4`) — el backlog "Sistema de personaje" deja la fórmula real sin cerrar; este es el primer valor de referencia a afinar, no una decisión cerrada.

## 3. Contenedores anidados — decisión de esta fase

El backlog lo dejaba abierto ("¿anidada dentro de la del cuerpo, o independiente?"). Decisión: **independientes**. Un ítem con `esContenedor:{ancho,alto}` (ej. `mochila_cuero`), al equiparse en su `slotEquipo`, aporta un `Contenedor` PROPIO (mapa `extras` en `InventarioSchema`, clave = slot o id de instancia), nunca fusionado dentro de la rejilla del cuerpo. Más simple de implementar y de razonar (cada contenedor se abre/inspecciona por separado, como en Project Zomboid de verdad) que una mega-rejilla fusionada.

## 4. Persistencia (`server/src/datos/bd.ts`)

Dos tablas nuevas, mismo contrato dual SQLite/Postgres (`IAlmacenDatos`) que el resto del juego:

```
inventarios (jugador_id, contenedor_id, ancho, alto, siguiente_id, items JSON) — PK (jugador_id, contenedor_id)
equipo      (jugador_id, slot, item_id)                                        — PK (jugador_id, slot)
```

`contenedor_id` es libre (`"cuerpo"`, `"mochila_1"`...) — un jugador puede tener varias filas en `inventarios`, una por contenedor. `guardarContenedor`/`guardarEquipo` son upsert (reemplazo completo del set de slots en el caso de equipo — más simple que upsert slot a slot). `cargarContenedor` devuelve `null` si el jugador nunca guardó ESE contenedor (nuevo) — quien llame decide el tamaño por defecto con `crearContenedor()`. 13 tests de roundtrip/aislamiento por jugador.

## 5. Schema de Colyseus (`server/src/rooms/schema/HubState.ts`)

Espejo de red de lo de arriba — la lógica pura sigue siendo la fuente de verdad, el Schema es solo cómo viaja al cliente:

```
Player.inventario: InventarioSchema
  cuerpo: ContenedorSchema { ancho, alto, items: ItemInstanciaSchema[] }
  extras: Map<string, ContenedorSchema>   // mochilas equipadas
  equipo: Map<string, string>              // slot -> itemId
```

Verificado con `toJSON()` sobre una instancia real de `Player` — anidación Schema→Schema→ArraySchema construida y serializada sin errores.

## 6. Slots de equipo (nombres, sin mecánica de efecto todavía)

`espalda` (mochila), `cinturon` (bolsa pequeña), `manoPrincipal`/`manoSecundaria` (herramienta/arma/antorcha). Pendiente de cuando exista el sistema de personaje real: `cabeza`/`torso`/`piernas` para armadura, colgando de los mismos pivotes de `rigHumanoide.ts` que ya usa `ropa/` — incluidos a propósito FUERA de esta fase (armadura con efecto en Defensa física necesita el sistema de estadísticas, que tampoco existe todavía).

## 7. Qué falta (fases siguientes, no bloquean esta)

- **Fase 2 — coger del mundo / soltar al suelo**: reusar los "objetos sueltos de superficie" ya bakeados (`interiores/catalogo/elementos.json`) y los recolectables del exterior como origen real de `agregarItem`; mensajes Colyseus (`coger`, `soltar`) en `HubRoom`; radio de interacción o apertura de contenedor (pendiente de decidir, backlog).
- **Fase 3 — UI de cliente**: rejilla arrastrable de verdad, hoy no existe nada.
- **Activar `esContenedor` en el mobiliario del mundo** (`baul_tesoro`, `tinaja`, `baul_marinero` en `interiores/catalogo/elementos.json` — campo ya reservado, sin usar) y `lootTier` (`cofre_jefe` y los 5 contenedores únicos de mazmorra) para tablas de botín reales.
- **Integración con `HubRoom`**: cargar el inventario de un jugador al entrar y guardarlo al salir — no hecho en esta fase (`onJoin` de `HubRoom` es síncrono hoy; conectar la carga async es la costura natural con la fase 2, cuando además haga falta resolver `jugador_id` real por sesión, hoy la identidad solo se resuelve por nombre en el flujo de parcelas).
- **Sistema de personaje** (Fuerza real, no la fórmula placeholder de peso transportable) y **zonas prohibidas para soltar objetos** — ambos siguen "sin diseñar" en el backlog, este documento no los cierra.
