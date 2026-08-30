# GDD — Profesiones: edificios, mesas y mobiliario por oficio

## §0. DISEÑO DEFINITIVO DE OFICIOS DE JUGADOR (2026-08-30) — supera lo de abajo

Sesión del 2026-08-30: el streamer cerró los **10 oficios de jugador finales** (fusionando los 38 de más abajo), un sistema de **4 niveles de mesa por oficio** con **módulos de mejora por adyacencia**, **herramientas por tier** (recolección + mesa) y un **catálogo de objetos decorativos exclusivos** craftables. Lo de abajo (§1 en adelante) es el diseño PREVIO (38 oficios, sin fusionar) — se deja como referencia histórica de qué mesas/mobiliario ya existían, pero la lista de oficios/niveles vigente es ESTA sección.

### Los 10 oficios (fusión de los 38 originales)

| Oficio final | Absorbe (nombre antiguo) |
|---|---|
| **herrero** | herrero + herrero_armaduras + herrero_armas("armero") + fletcher |
| **carpintero** | carpintero + leñador |
| **ingeniero** | carpintero_ribera (ahora también construye ciertos edificios, no solo barcos) |
| **picapedrero** | picapedrero + minero |
| **molinero** | molinero + panadero + agricultor + apicultor + ganadero |
| **cazador** | cazador + trampero |
| **cocinero** | cocinero + tabernero + destilador |
| **curandero** | curandero + herbolista + rol de escriba (mapas/documentos/registros) |
| **curtidor** | curtidor + peletero + carnicero + sastre + guarnicionero |
| **joyero** | joyero + vidriero + alfarero |

Eliminados del todo: `explorador` (no existe), `pescador` (libre para cualquiera con caña, sin oficio). `OFICIOS_JUGADOR_VALIDOS` (`server/src/rooms/base/RoomExteriorBase.ts`) y `items/catalogo/recetas.json` usan EXCLUSIVAMENTE estos 10 ids.

### Niveles de mesa (1-4) por oficio

Cada oficio tiene sus mesas repartidas en 4 niveles de complejidad (nombres/descripciones tal cual los dio el streamer), anotados con `nivelOficioMinimo:{oficio,nivel}` en `interiores/catalogo/elementos.json` (mecanismo ya existente de `docs/GDD_Crafteo.md §7bis`). Building donde se bakean (temaTaller, reusando edificios ya existentes salvo `cazador`, que es NUEVO — ver más abajo):

| Oficio | Edificio (temaTaller) | N1 | N2 | N3 | N4 |
|---|---|---|---|---|---|
| herrero | herreria | forja_campo, yunque_tocon | forja_piedra, yunque_cuerno⚡ | taller_armero, banco_ajuste | gran_forja⚡, martinete⚡ |
| carpintero | carpinteria | banco_tronzado | banco_carpintero | torno_madera⚡, mesa_talla_fina | estacion_curvado_vapor, mesa_ensamblaje |
| ingeniero | carpintero_ribera | mesa_delineante | banco_mecanizado⚡ | estacion_maquetas_navales | banco_ingenieria_pesada⚡ |
| picapedrero | picapedrero | banco_clasificacion_cincelado | mesa_mampuesto | estacion_canteria_muelas⚡ | gran_taller_mamposteria⚡ |
| molinero | molino | mesa_tajado_limpieza | molino_mano⚡, artesa_amasado | estacion_germinacion_mantequeria | gran_molino_agropecuario⚡ |
| cazador | **cazador** (NUEVO: `cabana_cazador`) | estacion_despiece_caza | banco_trampero | banco_arqueria_caza | estacion_cazador_supremo⚡ |
| cocinero | cocinero (+ destileria para alambique) | fogon_campamento | horno_barro_taberna | cocina_mamposteria, alambique⚡ | gran_cocina_destileria⚡ |
| curandero | herbolista | secadero_hierbas, mortero_grande_boticario | escritorio_escriba, mesa_diagnostico | estacion_boticario, mesa_destilado_esencias | scriptorium_alquimico, mesa_cirugia |
| curtidor | curtiduria / carnicero / sastre / peletero (según la mesa concreta) | mesa_raspado, mesa_despiece | tina_curtido, telar | mesa_corte_piel, mesa_corte | mesa_costura_pieles, mesa_bordado |
| joyero | joyeria / vidriero / alfareria (según la mesa concreta) | torno_alfarero⚡, banco_joyero | horno_vidrio⚡, horno_ceramica | mesa_engarce, mesa_tallado_cristal | mesa_fundicion_precioso⚡, mesa_esmaltado |

**Edificio nuevo `cabana_cazador`** (único oficio sin edificio previo): `interiores/catalogo/tipos_edificio.json`, `temaTaller:"cazador"`, registrado con peso en las pools `aldea_pequena`/`aldea` de `ciudades/catalogo/asentamientos.json` (mismo patrón que `cabana_apicultor`). Verificado con bake real: aparece en semillas 4 y 8 de un lote de 8 `aldea`, con `estacion_despiece_caza` colocada en su sala `taller`.

**Piezas donde el oficio fusionado abarca varios edificios legacy** (curtidor, joyero): cada mesa se queda en el edificio donde YA vivía antes de la fusión (p.ej. `telar`/`mesa_corte`/`mesa_bordado` siguen en el edificio de sastre, `mesa_corte_piel`/`mesa_costura_pieles` en el de peletero) — un jugador de ese oficio final trabaja en más de un edificio físico según qué mesa use. Simplificación aceptada explícitamente para no inventar una reconsolidación de edificios que nadie pidió.

### Limpieza de mesas viejas duplicadas (2026-08-30, quinta pasada)

Pedido literal: "si están duplicadas borra o unifica con las últimas creadas, para que las que pactamos antes sean las reales y únicas". De las "9 mesas viejas" que seguían con receta propia en paralelo (pre-fusión, `§1` de abajo):

- **2 NO eran duplicado real** — `banco_carpintero_ribera`/`mesa_calafateo` (recetas `barco_1..4_construido`): sistema deliberadamente aparte de `docs/GDD_Barcos.md`, gateado por `edificioRequerido:"astillero"`, nunca colisiona en la misma sala que ninguna mesa de la tabla de arriba. Se dejan intactas.
- **5 SÍ colisionaban de verdad** (mismo `temasProfesion`+tipo de sala que su equivalente nuevo, así que un mismo taller podía generar AMBAS a la vez): `yunque`→`yunque_tocon`, `martillo_pilon`→`martinete`, `mesa_talla_piedra`→`banco_clasificacion_cincelado`, `mesa_tenido_cuero`→`tina_curtido`, `muela_piedra`→`molino_mano`. Borradas de `interiores/catalogo/elementos.json` (para que nunca vuelvan a bakearse) y las recetas que las usaban (`clavos_hierro`/`olla_metal`/`instrumental_cirugia`, `martillo_acero`, `pico_minero_tallado`, `mochila_cuero_curtido`/`silla_montar_curtida`, `harina`) retargeteadas al `mesas` nuevo — mismo resultado, misma receta, mesa única.
- **1 caso mixto** — `amasadora` (panaderia) y `artesa_amasado` (molino, nuevo): NO colisionan nunca en la misma sala (edificios distintos, `panaderia` sigue viva y registrada en 5 pools de asentamiento), así que no es el mismo bug — pero sí había DOS recetas (`masa_pan`/`masa_pan_artesa`) para el mismo resultado. Fusionadas en una sola (`masa_pan`, `mesas:["amasadora","artesa_amasado"]`) — mismo patrón multi-edificio ya aceptado arriba para curtidor/joyero. `horno_pan`→`pan` no tenía ningún duplicado, se deja tal cual.

**3 regresiones reales atrapadas ANTES de commitear** (borrar un catálogo entero, no solo su `temasProfesion`, se lleva por delante cualquier campo que el reemplazo nuevo no tuviera todavía copiado):
1. Los 4 ids borrados con `energia.consume` (Motriz, docs/GDD_Motriz.md) — `yunque`, `martillo_pilon`, `mesa_talla_piedra`, `muela_piedra` — tenían el gancho YA cableado; sus reemplazos nuevos (`yunque_tocon`/`martinete`/`banco_clasificacion_cincelado`/`molino_mano`) habían nacido SIN él (los `⚡` de la tabla de arriba eran aspiracionales, nunca wireados — gap previo a esta sesión, confirmado). Portado el mismo `energia` de cada viejo a su reemplazo directo — sin esto, un jugador conectado a la red motriz habría perdido el bonus de velocidad de golpe.
2. `yunque` cubría además la sala `arsenal` (`cuartel_guardia`/`arena_combate`, edificios de tema herrería que NO tienen sala `taller`) — `yunque_tocon` solo traía `tiposSalaValidos:["taller"]`. Añadido `"arsenal"` + los `allowedRoomTags` que le faltaban (`COMUN_ALMACEN`/`COMUN_MILITAR`).
3. `muela_piedra` cubría además `sala_molino` (la única sala de `molino_agua`, que NO genera salas `taller` en absoluto — sin esto, `molino_agua` se habría quedado sin NINGUNA mesa de molienda). `molino_mano` solo traía `["taller"]`; añadido `"sala_molino"` + `allowedRoomTags:"COMUN_AGRICULTURA"`. Las otras 3 mesas de molinero (N1/N3/N4) siguen sin cubrir `sala_molino` — gap preexistente a esta sesión, no introducido ni cerrado aquí, fuera de alcance de "quitar duplicados".

Verificado con un bake real (`interiores/src/edificio.js::generarEdificio`, sin pasar por CLI): 15 semillas de `herreria`/`molino`/`curtiduria`/`taller_picapedrero` cada una — CERO apariciones de los 5 ids borrados, y sus reemplazos (`martinete`, `molino_mano`, `tina_curtido`, `banco_clasificacion_cincelado`) sí aparecen; 40 semillas adicionales confirman que `yunque_tocon`/`artesa_amasado` (los de nivel 1, más disputados por presupuesto de sala) también salen; 30 semillas más de `cuartel_guardia` confirman `yunque_tocon` en su sala `arsenal`, y 30 de `molino_agua` confirman `molino_mano` en su `sala_molino` (las 2 regresiones de arriba, ya cerradas). Integridad referencial completa de `recetas.json` re-verificada tras el retargeteo (script de la pasada anterior, "TODO OK"). `tsc` limpio, servidor 805/805, interiores 41/41 + editor e2e 11/11.

### Módulos de mejora por adyacencia (mecanismo NUEVO)

Pedido literal: mesas de nivel 2 a 4 llevan dos complementos estándar — **Mejora A (velocidad)** y **Mejora B (cantidad/rendimiento)** — que, colocados ORTOGONALMENTE ADYACENTES a la mesa, aplican un bonus a cualquier crafteo hecho en ella:

```
tiempoFinal    = tiempoBase * (1 - bonusVelocidad)
cantidadFinal  = floor(cantidadBase * (1 + bonusCantidad))
```

- **Porcentajes** (no dados por el streamer, elegidos por defecto): nivel 2 → 12%, nivel 3 → 18%, nivel 4 → 25%. Mismo valor para velocidad y cantidad de un mismo nivel; cada módulo cuenta por separado (una mesa puede tener solo uno de los dos, o los dos).
- **Catálogo**: nuevo campo `EntradaConstruible.mejoraMesa?: { mesa: string; tipo: "velocidad"|"cantidad"; bonus: number }` (`server/src/construccion/catalogo.ts`). 60 piezas nuevas en `elementos.json` (2 por mesa de nivel 2-4 × 10 oficios), con los nombres exactos que dio el streamer (p.ej. `fuelle_mecanico_pedal`, `cuba_temple_recogedor`, `sierra_bastidor_tensor`...).
- **Resolución**: `bonusModulosAdyacentes(ctx, catalogo, viva)` (`server/src/construccion/construccion.ts`) — reutiliza el patrón de escaneo ya existente de `hayConstruibleAdyacente` (cocina v2), pero mirando `mejoraMesa` en vez de gatear la colocación. Como mucho un bonus de cada tipo cuenta (dos "velocidad" adyacentes no se suman, gana el mayor).
- **Aplicación**: `RoomExteriorBase.ts::manejarCrafteoIniciar` calcula el bonus AL INICIAR (se congela en `EstadoCrafteo.bonusCantidad`, igual que `terminaEn` — quitar/poner un módulo a media cocción no cambia el crafteo en curso) y recorta `duracionMs` directo; `manejarCrafteoRecolectar` aplica el bonus de cantidad congelado a `receta.resultado.cantidad`.
- **Corrección real durante la implementación**: los primeros módulos de curtidor/joyero/cocinero se etiquetaron con el edificio "principal" del oficio fusionado en vez del edificio REAL de la mesa a la que dan bonus (p.ej. `lanzadera_automatica_telar` boostea `telar`, que vive en el edificio de sastre, no en curtiduría) — un módulo que nunca puede bakearse en el MISMO edificio que su mesa objetivo jamás llegaría a estar adyacente a ella. Corregido pieza a pieza contra el `temasProfesion` real de cada mesa objetivo.
- **Tests**: `server/test/mejoraMesaAdyacente.test.ts` (6 tests, función pura con `ContextoConstruccion` sintético — sin/con módulo, velocidad+cantidad simultáneos, módulo de otra mesa no cuenta, diagonal no cuenta, dos módulos del mismo tipo no se suman).

### Herramientas por tier (recolección + mesa) — GATING YA CABLEADO

62 herramientas nuevas en `items/catalogo/items.json` (+ 3 existentes anotadas: `hacha_talar`, `pico_minero`, `cuchillo_desollar`), con `familiaMaterial:"herramienta_<oficio>"` y `tier:1-4` — mismo campo/convención YA existente (`EntradaCatalogoItem.tier`).

**Gating real implementado (2026-08-30, segunda pasada)**: `server/src/mundo/herramientasRecoleccion.ts` — tabla `CATEGORIA_HERRAMIENTA_RECOLECCION` (36 `categoriaRecurso` de `baker/catalogo/vegetacion.json`/`rocas.json` → `{oficio, tier}`, asignados por rareza real vía `densidadBase`) + `mejorHerramientaPara(contenedor, catalogo, requisito)` (busca en el inventario la herramienta de mayor tier de esa familia que no esté rota). `RoomExteriorBase.ts::manejarCoger` la aplica SOLO a la recolección salvaje del bake (`buscarCogibleEnMundo`), nunca a objetos ya soltados por otro jugador — sin la herramienta correcta, `coger:error` con el motivo exacto ("necesitas una herramienta de \<oficio\> (tier N o superior)"); con ella, se registra el uso (desgaste) igual que `cuchillo_desollar`.

**Minería real (2026-08-30, tercera pasada)** — pedido literal: "igual que tala un árbol el leñador... este mina rocas". `rocas.json` no tenía NINGUNA entrada con `desaparaceAlRecolectar:true` (hueco preexistente, no de esta sesión): la tabla de picapedrero existía pero era inerte. Corregido añadiendo `desaparaceAlRecolectar:true` a las 36 entradas de `rocas.json` con `categoriaRecurso` (arcilla/turba/piedra_comun/carbón hasta oro/platino/gema) — reusa el pipeline GENÉRICO de "coger" (más simple que `arbol:talar`/`GestorBosques`, que es un sistema propio para árboles con propagación por semilla; una veta de mineral no "crece" igual). Sin rebake: el mapa demo ya tenía `piedra_comun` bakeado y pasó a ser recolectable de verdad al instante.

**Reaparición temporizada — respawn (2026-08-30, cuarta pasada)** — pedido literal: "lo que recolectamos y desaparece tiene un timer para que vuelva a aparecer... unificar con árboles, rocas y todo recolectar". Los árboles **se quedan exactamente igual** (decisión explícita del streamer tras explicarle el trade-off): `GestorBosques` ya tiene un sistema más sofisticado (semilla/propagación sostenible — un árbol talado en su sitio bake NUNCA vuelve ahí, el bosque rebrota vía nuevos brotes cerca de árboles adultos vivos); sustituirlo por un timer simple habría sido una REGRESIÓN. El timer simple es SOLO para hierbas/rocas (todo lo que pasa por `coger` genérico):
- `server/src/mundo/herramientasRecoleccion.ts::tiempoRespawnMsDeCategoria(categoriaRecurso)` — reusa el `tier` YA asignado por rareza real (más raro = tarda más): tier1=5min, tier2=15min, tier3=30min, tier4=60min.
- `server/src/mundo/recolectables.ts::recolectablesAgotadosDeMapa(rutaMapa)` — `Map<idx, epoch ms>` (renombrado desde el `Set` que borraba para siempre) cacheado por proceso igual que `recolectablesDeMapa`; NO hay persistencia (un reinicio del servidor resetea recolectables Y agotados juntos, coherentes entre sí).
- `recolectableCercano(...)` acepta el Map de agotados: salta los índices todavía en el futuro y se AUTOLIMPIA sola (borra la entrada) en cuanto su timestamp ya pasó — sin ningún tick de fondo, mismo "cálculo perezoso" del proyecto (CLAUDE.md).
- `RoomExteriorBase.ts::buscarCogibleEnMundo` ya NO borra el recolectable al confirmarlo: marca `agotados.set(idx, Date.now() + tiempoRespawnMs)`. El handler `sector:exclusiones` (consulta re-preguntable del cliente para no dibujar el modelo bakeado de algo agotado) recorre el mismo Map y también poda las entradas ya vencidas.

Verificado con datos reales: 11 tests puros de gating (`server/test/herramientasRecoleccion.test.ts`, incluye cobertura contra el catálogo real del baker + `tiempoRespawnMsDeCategoria` por tier) + 6 tests puros de respawn (`server/test/recolectables.test.ts`: agotado con timestamp futuro se salta, timestamp vencido se autolimpia y vuelve a estar disponible, caché por ruta) + 1 E2E contra el servidor real y el mapa demo (`server/test/herramientasRecoleccion.e2e.mjs`: sin herramienta se rechaza con el motivo correcto sobre un `flor_medicinal` real del bake; con `tijera_herbolario_fina` (curandero tier 3) se coge de verdad; con `pico_minero_hierro` (picapedrero tier 1) se mina un `piedra_comun` real).

### Recetas completadas (2026-08-30, tercera pasada)

Pedido literal: "vas a crear diferentes recetas según muebles y objetos que ya tengamos... una silla se fabrica con X material, y sale de ese color... todo crafteo requiere un tiempo determinado, no hay cola de crafteo, puedes craftear el mismo objeto varias veces" (el tiempo por complejidad y el no-cola-de-crafteo YA existían — `tiempoBaseSeg` y el slot único `craftesEnCurso`; craftear el mismo objeto varias veces ya funcionaba de fábrica). `items/catalogo/recetas.json` pasó de ~24 a 143 recetas:
- **59 recetas de equipo ya existente sin receta**: ~59 items de armas/armaduras/joyería (`docs/GDD_Equipo.md`) tenían stats reales pero CERO forma de craftearse — herrero (armas + armadura hierro/acero), curtidor (armadura de cuero + bolsas/bandoleras), joyero (anillos/brazaletes), usando las mesas de nivel 1-4 nuevas.
- **Material determina la variante visual**: 3 sillas (`silla_pino`/`silla_roble`/`silla_nogal_tallada`) y 2 mesas de comedor (`mesa_comedor_pino`/`mesa_comedor_roble`) — un item+receta+mueble por material, cada uno con `requiereItemColocar` a sí mismo (mismo patrón que `olla_barro`/`olla_metal`, docs/GDD_Cocina.md): cualquier madera vale para la receta base, pero CUÁL exactamente decide el color/variante final.
- Verificado con un script de integridad referencial recorriendo TODO `recetas.json` (cada `mesas`/`insumos`/`resultado` resuelve a un item/mueble real del catálogo).
- **Pendiente real, no cerrado esta pasada**: 3 mesas siguen sin ninguna receta (`mesa_corte`, `mesa_destilado_esencias`, `mesa_despiece` — curtidor/curandero) por falta de un item preexistente sin dueño que encajase bien.

### Objetos decorativos exclusivos (craftables)

50 piezas (5 por oficio, repartidas en los 4 niveles) — mobiliario puramente decorativo (`aportes.decoracion`) que NO se puede colocar gratis desde el menú de construir normal: se craftea primero (receta `<id>_craft` en `recetas.json`, oficio+mesa+nivel correctos) como un ITEM en `items/catalogo/items.json`, y el mueble en `elementos.json` lleva `requiereItemColocar:"<id>"` — mismo patrón exacto que `olla_metal`→`olla_grande` (docs/GDD_Cocina.md). Así "exclusivo" es real: hace falta el oficio, el nivel de mesa y los materiales, no solo construir.

### Verificado (2026-08-30)

`tsc` limpio, servidor 805/805 (785 + 6 de módulos + 11 de gating de herramienta, antes 9 + 3 tests nuevos de respawn en `recolectables.test.ts`, que ya venía incluido en los 785), interiores 41/41 (74 tipologías de edificio, antes 73 — `cabana_cazador`), ciudades 13/13. Bake real de 8 semillas de `aldea` confirmando `cabana_cazador` + su mesa de nivel 1 colocada en al menos una instancia. E2E real (`herramientasRecoleccion.e2e.mjs`) contra el mapa demo verificando el gating de principio a fin, incluida la roca minada de verdad.

---

## §1 en adelante — diseño PREVIO (2026-08-29), 38 oficios sin fusionar

**Histórico, no vigente para la lista de oficios de jugador** (esa es la §0 de arriba) — se conserva porque documenta qué mesas/mobiliario concretos ya existían antes de la fusión, y sigue siendo la referencia de qué building/temaTaller usa cada mesa legacy.

**Aplicado**: 50 mesas/mobiliario nuevos + 3 retrofits (`interiores/catalogo/elementos.json`), 8 edificios nuevos + `temaTaller:"molino"` en `molino_agua`/`molino_viento` (`interiores/catalogo/tipos_edificio.json`), 8 NPCs de oficio nuevos (`personajes/catalogo/npcs.json`), 8 entradas oficio→edificio (`poblacion/catalogo/oficiosEdificios.json`), y los 8 edificios nuevos + `lonja_pescado` (huérfana desde siempre, nunca se bakeaba) registrados con peso en las 5 pools de asentamiento correspondientes (`ciudades/catalogo/asentamientos.json`). Verificado: 34/34 tests de interiores (con las 54 tipologías de edificio generando sin error), 214/214 tests de servidor, 13/13 tests de ciudades, `tsc` limpio, y bakes de prueba reales (aldea_pequena/pueblo/capital) confirmando que los 9 edificios aparecen y sus mesas se colocan.

**3 bugs reales encontrados y corregidos durante la verificación** (antes de commitear, no después):
1. Las mesas de oficios que "comparten" edificio existente (herrero_armas/herrero_armaduras→herreria, guarnicionero→curtiduria, curandero→herbolista) llevaban `temasProfesion` con el nombre del OFICIO en vez del `temaTaller` real del edificio — el generador de interiores filtra por coincidencia exacta edificio.temaTaller↔pieza.temasProfesion, así que esas mesas nunca se habrían colocado en ningún edificio real. Corregido retagueando al `temaTaller` correcto.
2. Retofitear `mapa_mesa` (existente) con `temasProfesion:["explorador"]` la habría sacado de `ayuntamiento`/`casa_gremio` (que no tienen `temaTaller`, así que antes se colocaba sin filtro) — revertido; `mesa_cartografia` se dejó igualmente sin filtro.
3. `molino_agua`/`molino_viento` (Motriz) no tenían `temaTaller`, así que NINGUNA pieza de molino (ni las de antes ni las nuevas) se habría colocado nunca en ellos — corregido añadiendo `temaTaller:"molino"`. Además `muela_piedra`/`saco_harina` (ya existentes) no incluían `sala_molino` en `tiposSalaValidos` — corregido.

Convención de esta tabla: **⚡** = la mesa debería llevar `energia.consume` (docs/GDD_Motriz.md) — se beneficia de estar conectada a un molino vía eje/palancas. "ya" = pieza que YA existe en el catálogo (`interiores/catalogo/elementos.json`, comprobado); todo lo demás es NUEVO. "Edificio: ya" = el `tipos_edificio.json` ya tiene esa entrada con ese `temaTaller`; "NUEVO" = hay que darlo de alta.

Hallazgo al revisar el catálogo actual antes de proponer nada: **`sierra_grande` (con `energia.consume` desde Motriz) pertenece al `temaTaller` "aserradero"** — el edificio-plantilla del jarl de Producción (madera automática, sin jugador) — **no** al `temaTaller` "carpintero" que usa el edificio `carpinteria` (que hoy solo tiene `banco_carpintero`/`estante_herramientas`, sin campo `energia`). Son dos cadenas distintas a propósito: el aserradero produce madera en bruto solo; el carpintero (abajo) la transforma en objetos. No confundir al implementar.

## Tier 1 — ya con gancho `energia` de Motriz puesto

### Herrería — Edificio: `herreria` (ya) — NPC: `herrero` (ya en `oficiosEdificios.json`)
| Mesa | Tier | ⚡ |
|---|---|---|
| `yunque` (ya) | básica | ⚡ ya |
| `fragua` (ya) | básica | no (calor manual/carbón) |
| `martillo_pilon` (NUEVO) | avanzada | ⚡ — martillo mecánico para piezas grandes |
| `mesa_grabado_armas` (NUEVO) | avanzada | no — detalle fino a mano, para herrero de armas |

Mobiliario: `armero` (ya), `fuelle` (ya). Decoración: espadas/escudos de pared, ristra de herraduras, brasero.

### Carpintería — Edificio: `carpinteria` (ya) — NPC: `carpintero` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `banco_carpintero` (ya) | básica | no |
| `torno_madera` (NUEVO) | básica-avanzada | ⚡ — tornea patas/postes |
| `mesa_ensamblaje` (NUEVO) | avanzada | no — monta muebles/estructuras |
| `mesa_talla_fina` (NUEVO) | avanzada | no — tallado decorativo a mano |

Mobiliario: `estante_herramientas` (ya). Decoración: virutas de madera, herramientas colgadas, muestrario de maderas.

### Alfarería — Edificio: `alfareria` (ya) — NPC: `alfarero` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `torno_alfarero` (ya) | básica | ⚡ ya |
| `horno_ceramica` (ya) | básica | no |
| `mesa_esmaltado` (NUEVO) | avanzada | no |
| `mesa_moldes` (NUEVO) | avanzada | no — piezas en serie |

Decoración: vasijas/jarrones expuestos, estantería de piezas secando.

## Tier 2 — edificio + oficio NPC ya existen, cierran un bucle de recurso ya producido en vivo

### Apicultor — Edificio: NUEVO `cabana_apicultor` (pequeña) — NPC: NUEVO `apicultor`
La colmena (exterior, Producción) ya es la "fuente"; esta cabaña es donde se transforma lo recolectado.
| Mesa | Tier | ⚡ |
|---|---|---|
| `mesa_extraccion_miel` (NUEVO) | básica | no |
| `prensa_cera` (NUEVO) | básica | no |
| `mesa_hidromiel` (NUEVO) | avanzada | no — fermenta miel, cruza con destilería |

Decoración: panales colgados, tarros de miel en fila, ahumador.

### Molinero — Edificio: `molino`/`molino_agua`/`molino_viento` (ya) — NPC: `molinero` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `muela_piedra` (ya) | básica | **proponer ⚡** — es literalmente lo que mueve la rueda hidráulica/aspas |
| `criba_grano` (NUEVO) | básica | no |
| `mesa_ensacado` (NUEVO) | avanzada | no |

Mobiliario: `saco_harina` (ya). Decoración: sacos de grano apilados, polvo de harina ambiental.

### Panadero — Edificio: `panaderia` (ya) — NPC: `panadero` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `amasadora` (ya) | básica | opcional ⚡ — amasado mecánico |
| `horno_pan` (ya) | básica | no |
| `mesa_formado` (NUEVO) | avanzada | no |
| `mesa_reposteria` (NUEVO) | avanzada | no |

Mobiliario: `estante_pan`, `pala_horno` (ya). Decoración: panes colgados, cesta de hogazas.

### Curtidor — Edificio: `curtiduria` (ya) — NPC: `curtidor` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `tina_curtido` (ya) | básica | no |
| `mesa_raspado` (NUEVO) | básica | no — limpia la piel antes de curtir |
| `mesa_tenido_cuero` (NUEVO) | avanzada | no |

Mobiliario: `bastidor_secado_pieles` (ya). Decoración: pieles curtidas colgadas.

## Tier 3 — edificio + oficio NPC ya existen, sin bucle de recurso previo

### Joyero — Edificio: `joyeria` (ya) — NPC: `joyero` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `banco_joyero` (ya) | básica | no |
| `mesa_engarce` (NUEVO) | avanzada | no — engastar gemas |
| `mesa_fundicion_precioso` (NUEVO) | avanzada | ⚡ — crisol pequeño, fuelle mecánico |

Mobiliario: `vitrina_joyas` (ya). Decoración: gemas/anillos expuestos, balanza de precisión.

### Sastre/tejedor — Edificio: `taller_sastre` (ya) — NPC: `sastre` (ya)
Solapa con lo que `ropa/` ya genera proceduralmente — repartir cuando toque diseñar recetas (¿el sastre-jugador desbloquea variantes/calidad, no reinventa el generador?).
| Mesa | Tier | ⚡ |
|---|---|---|
| `telar` (ya) | básica | opcional ⚡ — telar mecánico avanzado |
| `mesa_corte` (NUEVO) | básica | no |
| `mesa_bordado` (NUEVO) | avanzada | no |

Mobiliario: `maniqui_costura`, `rollo_tela` (ya). Decoración: retales de tela, prendas colgadas.

### Tendero — Edificio: `tienda` (ya) — NPC: `tendero` (ya)
**Excepción al patrón**: no fabrica nada (Mercado ya resuelve su mecánica). Mobiliario: `mostrador`, `estanteria_mercancias`, `cofre_monedas_tienda` (ya). Sin mesas de crafteo — como mucho un `mesa_empaquetado` (NUEVO, cosmético) si se quiere el gesto visual.

### Tabernero — Edificio: `taberna`/`posada` (ya) — NPC: `tabernero` (ya)
| Mesa | Tier | ⚡ |
|---|---|---|
| `mostrador` (ya) | básica | no |
| `mesa_cocina_taberna` (NUEVO) | básica | no |
| `barril_cerveza_casera` (NUEVO) | avanzada | no — cruza con destilería |

Mobiliario: `estante_jarras`, `tonel_vino` (ya).

## Tier 4 — recolección primaria: SIN mesas de fabricación real (excepción explícita)

Estos oficios recolectan materia prima, no la transforman — su "estación" es un punto de recolección en el bake exterior o, como mucho, un mueble de almacenamiento intermedio. No fuerzo el patrón "2-4 mesas" aquí; forzarlo produciría mesas de relleno sin función real.

| Oficio | Edificio | Punto/mueble | NPC |
|---|---|---|---|
| Minero | NUEVO `entrada_mina` (POI/mazmorra, no edificio de aldea) | veta de mineral (recolectable exterior/subterráneo) | NUEVO `minero` |
| Leñador | — (recolección exterior) | `tronco_apilado` (ya, tag `aserradero` — reusar) | NUEVO `lenador` |
| Agricultura | campos de cultivo (ya, decoración exterior) + `granero` (ya, sin oficio) | — | NUEVO `agricultor` |
| Pesca | `lonja_pescado` (ya) | `red_pesca`, `barril_salazon` (ya) — ver mejora abajo | `pescador` (ya) |
| Caza | — (recolección exterior) | — | NUEVO `cazador` |
| Trampero | — (recolección exterior) | — | NUEVO `trampero` |
| Cría de animales | `establo` (ya, sin oficio) | — | NUEVO `ganadero` |
| Montar a caballo | `establo` (ya) | — | (no es oficio de producción, es transporte/movilidad) |

**Única mejora real de Tier 4** — Pesca ya tiene edificio+mobiliario, se le puede subir a mesas de verdad sin inventar nada de golpe: `mesa_eviscerado` (NUEVO, básica) + `ahumadero_pescado` (NUEVO, avanzada).

## Tier 5 — sin building todavía, o dependen de sistemas no construidos (combate, heridas, barcos)

Propuestas más ligeras (menos detalle de mobiliario/decoración) — están más lejos de implementarse y probablemente cambien al diseñar sus recetas.

| Oficio | Edificio | Mesas (básica→avanzada) | NPC |
|---|---|---|---|
| Herrero de armas | comparte `herreria` (especialización, no building propio) | `mesa_forja_hojas`, `mesa_afilado`⚡ | NUEVO `herrero_armas` |
| Herrero de armaduras | comparte `herreria` | `mesa_remachado`, `yunque_armadura`⚡ | NUEVO `herrero_armaduras` |
| Tallador de piedra/picapedrero | NUEVO `taller_picapedrero` | `mesa_talla_piedra`⚡(opcional), `banco_pulido` | NUEVO `picapedrero` |
| Peletero | comparte `curtiduria` o NUEVO `peleteria` | `mesa_corte_piel`, `mesa_costura_pieles` | NUEVO `peletero` |
| Herbolista | `botica`/`choza_curandero` (ya) | `mortero_grande_boticario` (ya), `secadero_hierbas` (ya), `mesa_destilado_esencias` (NUEVO, avanzada) | NUEVO `herbolista` |
| Vidriero | NUEVO `vidrieria` | `horno_vidrio`⚡, `mesa_soplado`, `mesa_tallado_cristal` | NUEVO `vidriero` |
| Arquero/ballestero (fletcher) | comparte `carpinteria` o NUEVO `taller_arquero` | `mesa_encordado`, `banco_tallado_arcos` | NUEVO `fletcher` |
| Guarnicionero | comparte `curtiduria`/`establo` | `mesa_guarnicionero`, `banco_monturas` | NUEVO `guarnicionero` |
| Destilador/cervecero | `destileria` (ya) | `alambique` (ya, opcional⚡ avanzada), `mesa_mezcla` (NUEVO, básica) | NUEVO `destilador` |
| Constructor | — (es el sistema de construcción ya implementado) | sin mesas — no aplica | (no es oficio de mesa) |
| Cocinero | NUEVO `cocina_comunal` (o cocina de taberna/casa) | `mesa_corte_cocina`, `horno_cocina`, `mesa_especias` | NUEVO `cocinero` |
| Carnicero | NUEVO `carniceria` | `mesa_despiece`, `ahumadero` (avanzada) | NUEVO `carnicero` |
| Curandero/médico | `choza_curandero` (ya, compartido con herbolista — distinguir uso) | `mesa_diagnostico`, `mesa_cirugia` (avanzada) | NUEVO `curandero` |
| Mercader ambulante | `carromato_mercader` (ya) | — no craftea, es logística/venta itinerante | NUEVO `mercader_ambulante` |
| Navegante / Capitán de barco | — (rol de movimiento, no crafteo) | — | NUEVO `navegante`/`capitan` |
| Constructor naval/carpintero de ribera | NUEVO `astillero` (conecta "Puerto/Muelle Comunal" del backlog) | `mesa_calafateo`, `banco_carpintero_ribera` | NUEVO `carpintero_ribera` |
| Guardia/mercenario | `cuartel_guardia`/`arena_combate` (ya) | sin mesas — depende de combate | `guardia` (ya) |
| Explorador/cartógrafo | — (usa `mapa_mesa`, ya en catálogo de interiores) | `mapa_mesa` (ya), `mesa_cartografia` (NUEVO, avanzada) | NUEVO `explorador` |

## Resumen de lo que haría falta dar de alta si se aprueba

- **Edificios nuevos**: `cabana_apicultor`, `entrada_mina`, `taller_picapedrero`, `peleteria` (si no comparte curtiduria), `vidrieria`, `taller_arquero` (si no comparte carpinteria), `cocina_comunal`, `carniceria`, `astillero`.
- **NPCs de oficio nuevos** (`poblacion/catalogo/oficiosEdificios.json`): apicultor, minero, lenador, agricultor, cazador, trampero, ganadero, herrero_armas, herrero_armaduras, picapedrero, peletero, herbolista, vidriero, fletcher, guarnicionero, destilador, cocinero, carnicero, curandero, mercader_ambulante, navegante, capitan, carpintero_ribera, explorador.
- **Mesas/mobiliario nuevo en `elementos.json`**: ~45 piezas nombradas arriba, cada una con `temasProfesion` apuntando a su oficio (patrón ya establecido) y `energia` solo en las marcadas ⚡.
