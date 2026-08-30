# GDD — Ganadería (cría de animales domésticos)

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30), AMPLIADA el mismo día con cría de descendencia real (§11).** Piezas v1: `server/src/mundo/ganaderia.ts` (vallado por flood-fill + escape diario), `server/src/mundo/catalogoCombateFauna.ts` (`categoriaProductoGranja`), `baker/catalogo/animales.json` (6 especies etiquetadas), `server/src/construccion/catalogo.ts` (`EntradaAlimentador`/`EntradaRefugioGranja`), `interiores/catalogo/exteriores.json` (`comedero`/`bebedero`/`nido`/`cobertizo_ganado` nuevos, `gallinero` activado), `items/catalogo/items.json` (6 ítems nuevos), `server/src/rooms/schema/HubState.ts` (`AnimalGranjaSchema`, `ComercioSchema.ofertaAnimales*`), `server/src/datos/bd.ts` (tabla `animales_granja`, 9 funciones), `server/src/rooms/base/RoomExteriorBase.ts` (protocolo `animal:*` + extensión de `tenderete:*`/`comercio:*`), `server/src/mundo/faunaSalvajeViva.ts` (`GestorFaunaSalvaje.domesticar`), `server/src/rooms/HubRoom.ts`/`RegionRoom.ts` (`onFaunaDomesticada`, `RegionRoom.estadisticasFaunaDe` nuevo). Piezas de la ampliación (§11): `server/src/mundo/reproduccionGranja.ts` (nuevo, puro), `server/src/mundo/reproduccionFauna.ts` (+parámetro `probabilidadExito` en `intentarAparearse`, retrocompatible), `baker/catalogo/animales.json` (+`coneja`/`gazapo`, `conejo` domesticable, `criasPorCamada` en cerdo/cerda/conejo/coneja, campos de reproducción reales en `gallina_salvaje`), `server/src/rooms/base/RoomExteriorBase.ts` (`resolverReproduccionAnimalesPropiedad`, huevos físicos, `PRODUCTOS_GRANJA` sin "huevos"). Probado: `ganaderia.test.ts` (10), `animalesGranja.test.ts` (8), `reproduccionGranja.test.ts` (15, nuevo), suite completa de servidor 587/587, `tsc --noEmit` limpio en server.

Pedido del streamer v1 (2026-08-30): cría de animales domésticos ligada al oficio de granjero/ganadero — comprar o domesticar animales en el exterior y llevarlos a tu propiedad (sin propiedad, no se puede criar); comedero+bebedero con acceso diario; vallado real comprobado por código, 20% de posibilidad de escape si no está vallado (si lo está, nunca escapa); si escapan dejan de ser tuyos y vuelven a ser libres; productos: leche (vaca/cabra/oveja), lana (oveja), huevos (gallina/ganso), carne de todos incluido el cerdo; herramientas/mobiliario para extraer cada producto (comederos, nidos, gallineros, establos); los animales, como propiedad, se pueden vender/traspasar/comerciar/matar/perder.

Pedido del streamer de la ampliación, verbatim (2026-08-30): "vamos a completar Cría de descendencia en animales de granja (ganadería produce leche/huevos/lana pero no se reproducen): los animales como los salvajes tienen esa probabilidad si tienen uno de su especioe y otro sesxo de reproducirse usane l mismo sistema de los salvajes pero estos tienen mas % de que se reproduszcan por que es mas facil al tenerlos acotados bien alimentados etc. las gallinas y aquellos que sea por huevo, necesitaran almenos 1 macho cerca, las gallinas o gansos o patos que sean y cada dia dejaran de 1 a 3 huevos en suelo o en un nido si tienen, si no tienen nido ponen 1 en suelo si tienen nido de 1 a 3 cada dia. (el huevo tiene prop sprite y se puede ver en el suelo o en elnido) aparece la cria del resto de animales la mayoriua 1 menos cerdos conejos y si se te ocurre algun animal que salgan mas cachorros por camada / embarazo." **Nota**: la premisa de que "ganadería produce leche/huevos/lana" ya estaba implementada por otro agente en paralelo (§0-§10) — esta ampliación (§11) es SOLO la cría de descendencia, que en efecto faltaba entera.

## 0. Especies y productos — reusa el catálogo ya existente

`vaca/toro/buey/ternero`, `oveja/carnero/cordero`, `cabra/macho_cabrio/cabrito`, `cerdo/cerda/cerdito`, `gallina_salvaje/gallo/pollito`, `ganso_domestico/oca/ansarino` YA estaban en `baker/catalogo/animales.json` (trío macho/hembra/cría, `domesticable:true`, `categoriaRecursoCarne`/`categoriaRecursoPiel`) — solo faltaba la mecánica de cría en sí. Campo nuevo, `categoriaProductoGranja: ("leche"|"huevos"|"lana")[]`, aplicado por sexo real (biológicamente: leche/huevos solo en la hembra, lana en cualquier sexo con vellón):

| especie | productos |
|---|---|
| vaca | leche |
| cabra | leche |
| oveja | lana, leche |
| carnero | lana |
| gallina_salvaje (hembra doméstica reutilizada) | huevos |
| oca (hembra de ganso_domestico) | huevos |
| cerdo/cerda, toro/buey, macho_cabrio, gallo, ganso_domestico | — (solo carne/piel al sacrificar, ya cubierto por docs/GDD_Caza.md) |

**No se crean especies nuevas** — el catálogo ya cubría el pedido entero (6 tipos base × macho/hembra/cría). Sin cadena de procesado (queso, hilado de lana...): productos RAW únicamente, mismo alcance que "leche/huevos/lana" pedido explícito — una refinería futura es una iteración aparte, no bloquea esta v1.

## 1. Oficio `ganadero`

Añadido a `OFICIOS_JUGADOR_VALIDOS` (mismo sistema mínimo de `Player.oficio` de docs/GDD_Caza.md — gratis, instantáneo, sin exclusividad). Gatea SOLO las dos extracciones con herramienta (ordeñar, esquilar) — poseer animales, alimentarlos, recolectar huevos o sacrificar NO exigen oficio, mismo criterio que desollar/raspar de la caza (herramienta+oficio en el paso "de artesano", el resto libre).

## 2. Adquirir un animal — domesticar o comprar

### 2.1 Domesticar en el exterior — `animal:domesticar { propiedadDestino }`

Auto-apunta al animal más cercano (`RADIO_INTERACCION`) cuya especie sea `domesticable && categoriaRecursoCarne` (distingue ganado de mascotas/monturas: perro/gato/caballo/burro son domesticables pero SIN carne, así que nunca son candidatos aquí — ver `catalogoCombateFauna.ts`). Mismo umbral que mascotas (`VECES_COMIDA_PARA_DOMESTICAR_GRANJA = 5`, consume 1 ítem `comidaMascota:true` por intento) pero, al completarse, en vez de nacer una `Mascota` que sigue al jugador nace un `AnimalGranja` en `propiedadDestino` — exige tener YA un refugio adecuado allí (`tieneRefugioParaCategoria`, §4).

Funciona tanto sobre fauna SALVAJE (HubRoom, p.ej. `cabra`, vía `GestorFaunaSalvaje.domesticar` — nuevo método gemelo de `matarIndividuo` pero SIN cadáver/loot, reusa `estado:"muerto"` con el mismo significado real "ya no vive aquí") como URBANA (RegionRoom, p.ej. vaca/oveja/cerdo/gallina, vía `GestorFauna.quitar`, ya existente). **Efecto colateral corregido**: `RegionRoom` no sobreescribía `estadisticasFaunaDe` (siempre `null` de la clase base) — sin esto, ni domesticar ni `cadaver:desollar` funcionaban nunca ahí; se añadió el override que ya tenía HubRoom.

### 2.2 Comprar por tenderete — `tenderete:listarAnimal`/`comprarAnimal`

Decisión del streamer: *"en un tendero, es como un objeto que cuando compras puedes designar a qué zona o propiedad tuya se hace TP"*. Un tenderete (docs/GDD_Mercado.md) ahora también puede listar animales — el dueño del animal Y del tenderete los lista con precio (`tenderete:listarAnimal`), cualquiera los compra indicando `propiedadDestino` (`tenderete:comprarAnimal`): cobra Farycoins (compare-and-swap atómico, mismo patrón que comprar ítems), exige que `propiedadDestino` sea del comprador Y tenga el refugio adecuado, y TP el animal allí (`bd.comprarAnimalGranja`, reubica `propiedadId`/`x,y` en la misma operación que cobra). `tenderete:escaparate`/`gestion` ahora incluyen `animales: []` junto a `items: []`.

**Límite deliberado v1**: comprar/listar un animal exige estar en la MISMA región donde vive (`animalesGranjaPuros` es un caché en memoria por room, igual que `cadaveresPuros`) — comercio de animales entre regiones distintas no está soportado, mismo alcance que el resto de Mercado (sin colocación entre mapas).

## 3. Traspaso entre jugadores — comercio (docs/GDD_Comercio.md)

`ComercioSchema` ganó `ofertaAnimalesA`/`ofertaAnimalesB` (`ArraySchema<string>`, solo el id — un animal es una instancia entera, sin "cantidad" que fraccionar) junto a las ofertas de ítems ya existentes. `comercio:ofrecerAnimal`/`quitarOfertaAnimal` mismo criterio que ofrecer un ítem (solo tu propio animal, cualquier cambio reabre la confirmación de ambos). Al confirmar (`manejarComercioConfirmar`, ahora async): valida que cada animal ofrecido SIGA siendo del ofertante Y que el receptor tenga refugio para recibirlo (`prepararTraspasoAnimales`, elige automáticamente la primera propiedad del receptor con refugio válido — sin selector de destino en el protocolo de comercio) — todo o nada, igual que el intercambio de ítems: si cualquier animal no cuadra, no se mueve NADA (ni ítems ni animales).

## 4. Refugios — gallinero/nido/cobertizo_ganado

Campo de catálogo nuevo, `refugioGranja: { categoriasVida: CategoriaVidaAnimal[] }` (`interiores/catalogo/exteriores.json` + `construccion/catalogo.ts`):

- `gallinero` (YA existía como stub "futura mecánica de cría" — activado con este campo) y `nido` (nuevo, más pequeño): `["pequeno", "mediano"]` — cualquiera de los dos sirve para traer aves.
- `cobertizo_ganado` (nuevo, "mueble grande visual", huella 4×3): `["mediano", "grande"]` — vaca/cabra/oveja/cerdo.

Sin refugio de la categoría adecuada en la propiedad destino, NO se puede domesticar ni comprar un animal hacia allí (§2). Es un requisito de COLOCACIÓN (una sola vez, al traer el animal) — no se vuelve a comprobar después.

## 5. Comedero y bebedero — acceso diario

- **`comedero`** (nuevo): campo `alimentador: { itemId, capacidadMaxMaterial }` — se carga a granel con `pienso` (`animal:cargarComedero`, mismo mecanismo de "cubo con stock" que `curtidor:cargarMaterial` de docs/GDD_Caza.md, pero sin lote ni transformación).
- **`bebedero`** (nuevo): reusa `requiereAgua: true` de las trampas de pesca (colocación junto a agua) — sin material que cargar, siempre "lleno" mientras siga junto al agua. Se distingue de una trampa de pesca (también `requiereAgua`) por NO tener `produccion`: `requiereAgua && !produccion` es la comprobación exacta.
- **`tieneComidaYAguaHoy(propiedadId)`**: hay comedero con stock>0 Y bebedero en la propiedad — gatea la producción (§6). "Acceso 1 vez diaria" se resuelve como "¿tiene AHORA MISMO?", no como historial día a día — más simple y coherente con el resto del proyecto (cálculo perezoso, sin guardar snapshots).

## 6. Productos — `resolverProduccion` reusado tal cual

**Decisión propia de diseño**: en vez de inventar un acumulador nuevo, cada animal reusa `resolverProduccion`/`EstadoProduccion` (`construccion/produccion.ts`, el mismo motor de colmena/curtidor) por producto, guardado en `AnimalGranjaFila.extra.produccion.{leche|lana|huevos}`. `datos.requiereTrabajador: true` siempre puesto, y `estado.trabajadorAsignado` se recalcula EN VIVO en cada resolución como `tieneComidaYAguaHoy(propiedadId)` — sin comida/agua, el reloj se congela (cero producción, cero castigo, exactamente la decisión del streamer: *"solo se congela la producción ese día"*).

`animal:recolectarProducto { animalId, producto }` — único mensaje genérico (config en `PRODUCTOS_GRANJA`, añadir un producto nuevo es una entrada de tabla, no un mensaje):

| producto | ítem | herramienta | oficio | cantidad/día | tope |
|---|---|---|---|---|---|
| leche | `leche` | `cubo_ordeno` | ganadero | 2 | 6 |
| lana | `lana` | `tijeras_esquilar` | ganadero | 1 | 3 |

**⚠️ "huevos" ya NO está en `PRODUCTOS_GRANJA`** (cambio de la ampliación §11, 2026-08-30): el acumulador abstracto se sustituyó por la puesta de huevos FÍSICA en el mundo, pedido explícito del streamer — ver §11.3.

## 7. Vallado real y escape — `server/src/mundo/ganaderia.ts`

**"Se comprobará por código"**: `estaEncerrado(mundo, x, y)` es un flood-fill (BFS 4-vecinos) acotado a `TOPE_CASILLAS_VALLADO = 500` casillas sobre la rejilla de colisión EN VIVO — portado del algoritmo de estanqueidad de murallas de `ciudades/src/generar.js` (`puntoEnPoligono`+flood-fill desde fuera), pero aplicado del revés: desde DENTRO. Cualquier `valla_madera`/`empalizada_tramo` ya colocada (colisión real) bloquea el flood-fill como cualquier sólido — **no hace falta ningún concepto nuevo de "recinto"**, una valla de verdad ya lo es. Si el flood-fill se agota sin escapar del tope → encerrado; si sigue creciendo (terreno abierto) → no.

`tiroEscape(diasTranscurridos, encerrado, rnd)`: si `encerrado`, NUNCA escapa. Si no, una tirada de `PROBABILIDAD_ESCAPE_DIARIA = 0.20` POR CADA día de mundo transcurrido desde la última resolución (tope `TOPE_DIAS_ESCAPE_CHEQUEADOS = 14`, para no lanzar miles de tiradas tras una ausencia larga). Resuelto perezosamente (`resolverEscapeAnimal`) en CUALQUIER interacción con el animal — nunca un tick de fondo.

**Al escapar**: se borra de BD/estado (deja de ser propiedad de nadie) y reaparece como `Fauna` normal en la room actual — *"volverían a ser libres al mapa exterior"*. **Simplificación deliberada v1**: NO se integra en `faunaSalvajeViva` (individuo persistente con reproducción propia, sector, BD) — el animal escapado es una `Fauna` sin tracking especial, mismo fallback seguro que ya usa `finalizarMuerte` para fauna sin gestor. Si se quiere que un animal escapado repueble de verdad la fauna salvaje, es una iteración futura que cruza con `docs/GDD_Agentes_Moviles.md`.

## 8. Sacrificar — reusa caza tal cual

`animal:sacrificar { animalId }` — exige `cuchillo_desollar` (reusado de docs/GDD_Caza.md), SIN oficio (matar tu propio animal no exige entrenamiento, al revés que ordeñar/esquilar). Reusa `rellenarLootCaza`/`pielDeDesollado` de `mundo/lootCaza.ts` TAL CUAL sobre un contenedor temporal (sin pasar por `Cadaver`: el animal desaparece del todo directamente, no deja cadáver looteable) — mismas tablas de carne/piel por `categoriaVida` que la caza salvaje.

## 9. Ítems nuevos (`items/catalogo/items.json`, 143 → 149)

`leche`, `huevo`, `lana` (productos, recurso "vivo" sin `categoriaRecurso`, igual que `miel`) · `pienso` (a granel, `comedero`) · `cubo_ordeno`, `tijeras_esquilar` (herramientas, no se consumen).

## 10. Pendiente (no bloquea v1)

- **Sin wiring de cliente**: ningún key/UI manda `animal:*`/`tenderete:*Animal*`/`comercio:*Animal` todavía — mismo hueco que producción/crafteo/refinamiento/curtidor, ninguno tiene tecla hoy tampoco. La cría de descendencia (§11) hereda el mismo hueco: se resuelve sola en el servidor, sin ningún mensaje ni UI dedicados.
- **Comercio de animales solo dentro de la misma región** (§2.2) — cruzar regiones exigiría consultar `animalesGranjaPuros` de otra room, fuera de alcance v1.
- **Escape no repuebla la fauna salvaje persistente** (§7) — reaparece como `Fauna` simple, sin reproducción ni sector.
- **Sin cadena de procesado** de leche/lana (queso, hilado) — productos RAW únicamente (§0), pedido explícito no incluía transformarlos.

## 11. Cría de descendencia (ampliación 2026-08-30, pedido explícito)

Reusa el motor de reproducción de la fauna salvaje (`server/src/mundo/reproduccionFauna.ts`, ya existente y sin tocar en su lógica) TAL CUAL sobre los `AnimalGranjaFila` de una propiedad — nuevo módulo puro `server/src/mundo/reproduccionGranja.ts`, sin fs/BD/Colyseus, mismo patrón que `ganaderia.ts`.

### 11.1 Reuso, no reimplementación

`intentarAparearse` ganó un 6º parámetro opcional `probabilidadExito` (por defecto 0.5, los 5 usos existentes de fauna salvaje no cambian). Ganadería pasa `PROBABILIDAD_EXITO_GRANJA = 0.85` — "más fácil al tenerlos acotados y bien alimentados", pedido explícito de más % que lo salvaje (0.5). El resto del pipeline (`elegibleParaAparearse`, `tocaDarALuz`, `tocaMadurar`, `resolverParto`) se reusa sin cambios — el catálogo YA traía `tamanoReproduccion`/`poneHuevos`/`dieta`/`criaId`/`criasPorCamada` para casi todas las especies de granja (heredado del trabajo de fauna salvaje), así que la ampliación fue sobre todo enganchar piezas ya construidas, no inventar nuevas.

**Catálogo, lo que sí faltaba**: `gallina_salvaje` (reutilizada como hembra doméstica desde v1) no tenía `tamanoReproduccion`/`poneHuevos`/`criaId`/`dieta` reales — se añadieron (`poneHuevos:true`, `criaId:"pollito"`). No existía pareja de conejos domesticable (`conejo` era `domesticable:false`, sin hembra) — se añadió `coneja` + cría `gazapo`, y `conejo` pasó a `domesticable:true`. `criasPorCamada:4` en cerdo/cerda y `criasPorCamada:3` en conejo/coneja — pedido explícito ("la mayoría 1 menos cerdos y conejos"); el resto de mamíferos (vaca/oveja/cabra) sigue pariendo 1.

**Por qué un catálogo de reproducción propio y no `catalogoFaunaSalvaje.ts`**: ese loader trata `poblacionInfinita:true` (como `gallina_salvaje`, para el spawn EXTERIOR) como "no reproduce, solo se rellena" — correcto para el mapa exterior, incorrecto para una gallina individual ya domesticada y guardada en BD. `cargarCatalogoReproduccionGranja` lee el MISMO `animales.json` pero ignora ese atajo.

### 11.2 Emparejamiento y maduración

`PAREJAS_GRANJA` (macho/hembra por clave) — reusa la convención YA establecida del catálogo (nombre real distinto por sexo: toro/vaca, carnero/oveja, macho_cabrio/cabra, cerdo/cerda, conejo/coneja, gallo/gallina_salvaje, ganso_domestico/oca). Resuelto perezosamente para la PROPIEDAD ENTERA de golpe (`resolverReproduccionAnimalesPropiedad`, a diferencia del escape que es por individuo — hace falta ver a todos los animales de la propiedad a la vez para emparejar), disparado en CUALQUIER interacción con un animal suyo (`animal:recolectarProducto`, `animal:consultar`), nunca en un tick de fondo.

Una cría que ya maduró (`tocaMadurar`, mismos días por tamaño que la fauna salvaje) se reemplaza por un adulto macho o hembra (50/50, `Math.random()`) de su pareja — al no existir un campo "sexo" propio en la convención de catálogo doméstico (macho/hembra son ids DISTINTOS, p.ej. "cerdito" madura a "cerdo" o "cerda"), la fila BD vieja se borra y nace una fila nueva con el especieId de adulto en el mismo sitio.

### 11.3 Huevos físicos en el mundo

Pedido explícito: "el huevo tiene prop sprite y se puede ver en el suelo o en el nido" — sustituye el acumulador abstracto de "huevos" que tenía v1 (§6, `animal:recolectarProducto`) por objetos reales (`ObjetoMundoSchema`, mismo mecanismo que soltar/cadáveres/pesca) en el sitio del ave. Requiere un macho ADULTO de su misma pareja en la propiedad — sin él, no pone. Una vez por día de mundo por hembra elegible (gatea igual que leche/lana: `tieneComidaYAguaHoy`). Cantidad: **1 en el suelo si la propiedad no tiene un `nido`** (o `gallinero`, mismo refugio de v1 §4) **construido, 1 a 3 si lo tiene** — pedido literal. El "nido" reusa la construible YA existente de v1, sin inventar un concepto nuevo.

### 11.4 Decisiones a confirmar con el streamer

- **"huevos" desaparece de `PRODUCTOS_GRANJA`** (§6) — antes daba un acumulador invisible por `animal:recolectarProducto`, ahora son objetos físicos recogibles por cualquiera. A confirmar si eso es lo que se quería o si se prefiere mantener ambos caminos.
- **`PROBABILIDAD_EXITO_GRANJA = 0.85`** — valor de partida "más alto que lo salvaje (0.5)", ajustable en `reproduccionGranja.ts` sin tocar nada más.
- Sin wiring de cliente (§10) — la cría/puesta de huevos ocurre solo en el servidor; el jugador la descubre al ver aparecer animales/huevos nuevos en su propiedad, sin ningún panel dedicado.
- Gestación/maduración usan las MISMAS duraciones que la fauna salvaje por tamaño (`GESTACION_DIAS`/`MADURACION_DIAS` de `reproduccionFauna.ts`) — no se pidió que fueran distintas para granja, así que no se duplicaron constantes.
