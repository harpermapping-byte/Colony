# Backlog de mecánicas futuras — esqueleto, no diseño cerrado

Ideas que ya hemos hablado y queremos que no se pierdan, aunque todavía no toque implementarlas. Nivel de detalle desigual a propósito: algunas están casi listas para construir, otras son solo el esqueleto de la idea. Se retoma y se afina cada una cuando le llegue el turno — no bloquea nada del bakeador de exteriores, que sigue siendo la pieza cerrada y ya construida.

## Crecimiento de bosques con el tiempo (dispersión de semillas) — HECHO (2026-08-30), alcance Hub

Al ampliar el catálogo de recolectables (árboles frutales, bayas, minerales — `baker/catalogo/vegetacion.json`/`rocas.json`) salió la idea de que los árboles no se queden fijos para siempre una vez horneados: cada X tiempo (a definir), un árbol existente "tira" una semilla al suelo en un radio corto a su alrededor, y de ahí puede nacer un árbol nuevo — así los bosques ya marcados por el bakeador crecen y se extienden con el tiempo jugado, como en la vida real, en vez de ser una foto fija del día 1. Confirmado explícitamente: **esto no es tarea del bakeador** — el bakeador solo genera el estado inicial (día 0) del mundo; que un bosque crezca con el tiempo es simulación en vivo del servidor, mismo principio que el resto de mecánicas de esta lista (clima, sombras, cono de visión, luz ambiente de interiores).

**HECHO (2026-08-30), ver `docs/GDD_Bosques.md`**: cada especie maderable tiene `radioPropagacion`/`probabilidadPropagacion`/`diasMaduracion` propios (28 especies, valores por tipo de madera — blanda rápida/prolífica, dura lenta). Resuelto perezosamente por sector (una tirada por árbol adulto elegible al reactivarse el sector, nunca una por día — evita explosión de población, mismo criterio que la reproducción de fauna salvaje), sin tope de densidad explícito (el propio requisito de "casilla libre" lo autolimita: cuanto más denso el bosque, menos huecos quedan). Talar un árbol también da semillas plantables (`arbol:talar`/`arbol:plantar`), mismo mecanismo de maduración. Consume posiciones NUEVAS fuera del pool de recolectables del bakeador — no lo toca. **Límite conocido**: alcance Hub únicamente (RegionRoom no lo tiene todavía) y los árboles del bake original nunca se sincronizan como entidad viva al cliente (talar uno funciona del todo en servidor, pero el modelo se queda visualmente en pie — mismo tipo de límite ya aceptado en "coger" del bake, ver GDD §7).

## Recolectables con pool de puntos de spawn — concepto y bakeador cerrados, activación/respawn en vivo pendiente

Con el catálogo de recolectables (comida: bayas, frutas, frutos secos, raíces, setas, cereales, hierbas — `categoriaRecurso` en `vegetacion.json`) creció la pregunta de qué pasa cuando el jugador recoge algo: **los árboles no desaparecen** (se coge el fruto, el árbol se queda — mismo árbol seguirá dando fruta), pero **arbustos, plantas silvestres y setas sí desaparecen** al recolectarse (`desaparaceAlRecolectar: true` en el catálogo) y necesitan reaparecer en algún otro punto más adelante para que el recurso no se agote para siempre.

Ya está construido en el bakeador (`baker/src/decoracion.js`) el mecanismo de datos que hace esto posible sin tener que re-hornear el mapa cada vez que cambie la densidad de spawn deseada: en vez de decidir un único resultado final por casilla, el bakeador genera un **pool de candidatos** (`multiplicadorPool`, por defecto 3x más candidatos de los que estarán activos al principio) y marca cada uno `activo`/`ac:0` (inactivo, reserva) — mismo patrón aplicado ya a las 3 capas (vegetación, fauna, rocas), no solo a la comida. Con `multiplicadorPool: 1` se comporta exactamante como antes (todo activo, sin reserva).

**Lo que falta y es responsabilidad del servidor en vivo, no del bakeador**:
- Cuando el jugador recoge un `activo` con `desaparaceAlRecolectar: true`: marcarlo inactivo y activar OTRO punto del pool (no necesariamente el mismo sitio) — así el recurso "se mueve" con el tiempo en vez de reaparecer siempre en el mismo punto exacto.
- Cuánto tarda en reactivarse un punto tras recolectarse (tiempo de respawn) — pendiente de decidir.
- Si la fauna sigue el mismo pool/mecanismo de activación (el diseño ya lo soporta, capa `a` en los objetos exportados) o necesita reglas propias por ser móvil.
- Cómo cambia el jugador/streamer la cantidad activa en vivo (ej. "quiero más densidad de animales") sin re-hornear — leer más puntos del mismo pool ya exportado y activarlos, dato ya disponible en el archivo de sector.

## Ciclo de vida y reproducción animal — HECHO (2026-08-29/30) para fauna salvaje Y para animales de granja/domésticos

Idea original (plantillas compartidas por familia de animal, pocas plantillas, cada especie apunta a una): mamífero grande cría→joven→adulto, mamífero pequeño cría→adulto, ave/reptil/anfibio huevo→cría→adulto, pez alevín→juvenil→adulto, insecto 4 o 3 fases según metamorfosis. La implementación real se quedó en un modelo más simple de 2 etapas (cría/adulto genérico, con huevo como paso intermedio en las ovíparas) en vez de las fases intermedias con nombre propio de cada familia — cubre el mismo problema con menos superficie.

**HECHO, ver `server/src/mundo/reproduccionFauna.ts` (módulo puro) + `server/src/mundo/faunaSalvajeSector.ts` (integración en vivo) + `docs/GDD_Agentes_Moviles.md` (fases 2-6)**: apareamiento real (busca la pareja elegible más cercana de sexo opuesto en un radio, 50% de posibilidades de que cuaje), gestación por tamaño (pequeño 3 días, mediano 5-8, grande 15-20 — días de mundo), partos y huevos (con incubación propia), maduración de cría a adulto (10/20/40 días según tamaño), hambre/sed que bloquea el apareamiento si el animal no comió/bebió a tiempo (ventana de 1 día para herbívoros, 6 para carnívoros). Persistido en BD, resuelto perezosamente al cargar/consultar un sector — nunca tick a tick para toda la población. Cubre 67 especies (mamíferos salvajes + `gallo` doméstico + 2 reptiles/anfibios grandes/medianos); el resto del catálogo (insectos, peces, aves, reptiles/anfibios pequeños) es población infinita, más barata, sin ciclo de vida real. Verificado con `server/test/reproduccionFauna.test.ts` (17 tests).

**Corrección (2026-08-30): esto ya no es cierto, quedó desactualizado por el propio commit que lo resolvió** — `server/src/mundo/reproduccionGranja.ts` define `PAREJAS_GRANJA` (vaca, oveja, cabra, cerda, coneja, gallina, oca) reutilizando el motor de `reproduccionFauna.ts` pero con `PROBABILIDAD_EXITO_GRANJA = 0.85` (más alta que el 0.5 de la fauna salvaje, coherente con ser domesticados). Gestación, partos, maduración de cría y puesta de huevos físicos ya funcionan para animales de granja, integrado en vivo vía `resolverReproduccionAnimalesPropiedad` en `server/src/rooms/base/RoomExteriorBase.ts`. Verificado con `server/test/reproduccionGranja.test.ts` (15 tests). El commit `64a7419` ("Ganadería: cría de descendencia real") lo implementó pero no llegó a actualizar este backlog — corregido ahora.

## Necesidades de los animales — HECHO (parcial) para fauna salvaje y de granja, "comodidad" sigue sin diseñar

Hambre y sed YA cubiertas en ambos sistemas de animales que existen hoy: fauna salvaje vía `necesitaAgua`/`necesitaComida` (`reproduccionFauna.ts`, gatea el apareamiento, ver sección de arriba) y fauna de granja vía comedero/bebedero (`docs/GDD_Ganaderia.md` §5, `tieneComidaYAguaHoy`, gatea la producción de leche/huevos/lana ese día). En ningún caso es un valor 0-100 que se degrada como los vitales del jugador (`personaje/vitales.ts`) — son comprobaciones booleanas por ventana de tiempo (¿comió/bebió dentro de X días?), más simples que eso. **Comodidad sigue sin ningún valor ni mecánica** — no se ha definido qué sería ni cómo se mediría.

## Agricultura (labrar/macetas/riego/fertilizante/siembra por meses) — HECHO (2026-08-30)

Ver `docs/GDD_Agricultura.md`. Sed de la planta = nivel de agua (0-100, decae con los días de mundo); fertilizante también 0-100, opcional, da bonus de cosecha; el suelo se ve más claro cuanto más bajos están ambos. Siembra restringida por mes de mundo según la semilla. Sin enfermedades, transplante ni curación de plantas todavía (siguen "solo esqueleto, sin diseñar", ver nota más abajo) — v1 se quedó en agua/fertilizante/crecimiento/cosecha, que era el pedido explícito.

## Necesidades y salud de las plantas — enfermedades/transplante/curación siguen sin diseñar

Agua y fertilizante YA implementados (ver arriba). Lo que queda de esta idea original: enfermedades, transplante, muerte por descuido prolongado, curación — mencionado en el mismo sentido que la fertilidad del suelo ya anotada en `GDD_Bakeador_Exteriores.md` (sección 15). Falta definir mecanismos concretos.

## Injertos y cruces de cultivos — HECHO (2026-08-30), CONSTRUIDO TAL CUAL el diseño cerrado aquí

Primera pasada del mismo día había implementado una versión simplificada (recetas fijas de crafteo); el streamer confirmó explícitamente que quería el diseño original y se rehizo entero para seguirlo: 6 atributos numéricos 0-1 por cultivo (`RasgosCultivo` en `items/catalogo/items.json`), cruce en `mesa_injertos` como media de los dos padres + variación aleatoria (`server/src/cultivo/cultivo.ts::mezclarRasgos`), **combinación abierta** entre cualquier par de semillas (nada de recetas predefinidas), resultado registrado como especie **nueva y permanente** en BD (`cultivos_hibridos`, dual SQLite/Postgres — el `cultivos.json` que proponía este backlog se sustituyó por una tabla, ya que la especie nace en runtime, no se puede precompilar a un JSON en disco) con nombre automático renombrable a mano (`renombrarCultivoHibrido`, sin UI todavía). Los dos puntos que quedaban "pendiente" en este backlog (probabilidad de éxito del injerto, qué pasa si falla) se resolvieron: nunca falla, la variación vive solo en los rasgos resultantes. Ver `docs/GDD_Agricultura.md` §4.

## Combate — HECHO v1 (2026-08-30), con huecos documentados

Armas cuerpo a cuerpo y a distancia, salud/aguante, PvE contra fauna peligrosa y monstruos de mazmorra. PvP también decidido e implementado — ver más abajo.

**Costura 2026-08-29 (pedido del streamer, "los depredadores también son enemigos del jugador, y neutral — como un bandido pero animal")**: `baker/catalogo/animales.json` marcó 18 especies peligrosas con `disposicion: "neutral"` (no ataca salvo que se le provoque o se acerque el jugador dentro de su `radioAgro`, de 2 a 10 casillas según tamaño) frente a `hostil` (la facción bandida). En ese momento era solo dato, sin mecánica.

**HECHO (2026-08-30), ver `docs/GDD_Combate.md` ("ESTADO: ✅ IMPLEMENTADO")**: combate táctico por turnos real y verificado, no solo diseñado. Motor puro en `server/src/combate/{combate,arenaCombate,pathfindingArena}.ts` (con su propia suite de tests), `CombateSchema`/`CombateUnidad` en `server/src/rooms/schema/CombateState.ts`, 5 mensajes cableados en `RoomExteriorBase.ts` (`combate:iniciar/mover/accion/pasarTurno/huir`, `PA_MAX_COMBATE = 6`), instanciado en `ArenaCombateRoom.ts` con ventana de unión de 60s. El `radioAgro`/`disposicion` de 2026-08-29 YA dispara de verdad: PvE automático contra fauna peligrosa vía `HubRoom.comprobarEncuentrosAutomaticos` (cada 5s) y enemigos de mazmorra vía `DungeonRoom.poblarEnemigos`. Verificado con E2E real (`client/test/combate.e2e.mjs`), no solo tests unitarios. Huecos honestos que quedan (documentados en el propio GDD §8): UI todavía placeholder, sin árbol de habilidades, sin línea de visión en el combate táctico. **Corrección (2026-08-30)**: el propio GDD dice que "equipo real no entra en el cálculo de daño", pero eso quedó cerrado 9 minutos después de escribirse esa frase — el sistema de equipo del jugador (`RoomExteriorBase.ts::recalcularStatsJugador`) suma `calcularStatsEquipo()` de lo equipado a ataque/defensa, y alimenta tanto el combate simple como la arena táctica. Pendiente solo actualizar la frase en el propio GDD.

**PvP — HECHO v1 (2026-08-30), ver `docs/GDD_PvP.md`**: la pregunta "probablemente limitado o desactivado" ya está decidida y construida — interruptor global que solo el jarl puede activar por región (`pvp:fijar`), zonas seguras (Hub + capital) que SIEMPRE ganan sobre el interruptor, gating real en `manejarCombateIniciar`. Desactivado por defecto, coherente con el enfoque comunitario del proyecto.

## Oficios de crafteo (herrería, talla, y los que falten) — mecanismo HECHO (2026-08-29), árbol completo de recetas por oficio sigue pendiente

Recetas, estaciones de trabajo (yunque, mesa de talla...), progresión de habilidad por oficio, qué herramienta/nivel hace falta para cada receta.

**Apunte 2026-08-29 (docs/GDD_Motriz.md, cluster Motriz ya implementado)**: ciertas mesas de profesión SÍ necesitan potencia mecánica para craftear más rápido — el catálogo ya marca esto hoy (`energia.consume`+`multiplicador` en `yunque`, `torno_alfarero`, `sierra_grande`) y la red motriz (molino → eje/palancas → mesa) ya funciona de punta a punta, enganchada vía `factorVelocidadPorEnergia(ctx, catalogo, mesa)` (`server/src/construccion/energia.ts`).

**HECHO (2026-08-29), ver `docs/GDD_Crafteo.md`**: el sistema de crafteo en sí ya existe, con dos capas — refinamiento pasivo con insumos reales (cálculo perezoso, mismo patrón que producción) y crafteo activo con `RecetaCrafteo` (`planoRequerido`+`nivelMinimo`+mesa concreta) en `server/src/construccion/crafteo.ts` (`nivelDeXp`, `validarCrafteo`, `crafteoListo`, protocolo `crafteo:iniciar/recolectar` + `refinamiento:depositar` en `RoomExteriorBase.ts`), progresión de XP por oficio en tabla `jugador_oficios`. **Corrección (2026-08-30)**: `items/catalogo/recetas.json` tiene hoy **8 recetas reales** (no 7, y `espada_hierro_basica` ya no es una de ellas — cita obsoleta): `clavos_hierro`, `martillo_acero`, `hacha_talar_reforzada`, `pico_minero_tallado`, `mochila_cuero_curtido`, `silla_montar_curtida`, `toalla_tela_hilada`, `joyero_engarzado`. **Lo que sigue pendiente es solo volumen, no el mecanismo**: rellenar el árbol completo para los ~38 oficios de `docs/GDD_Profesiones.md` se hace oficio a oficio cuando le toque el turno.

## Cocina — HECHO (2026-08-30)

"Cocinar tal cual" al fuego (boost modesto sobre el ingrediente crudo) y combinar varios en cuenco/cazuela/olla para un plato nuevo — mismo criterio de combinación abierta + identidad permanente que los injertos (ver arriba). Bonus por mezclar vegetal+animal, como pedía este apunte ("carne, pescado, plantas/hierbas"). Ver `docs/GDD_Cocina.md`.

## Construcción de estructuras (más allá de las parcelas ya definidas) — sin diseñar

Planos/blueprints, materiales requeridos, niveles de mejora de una construcción, quién puede construir dónde (ligado a permisos de parcela).

**Nota 2026-08-28**: `taller-vox/generar_edificio.js` ya tiene el EJE DE VARIEDAD del nivel (`nivel` 1/2/3 en `generarEdificio`, escala plantas + densidad de decoración de una CASA) — pedido explícito del streamer ("casa1, casa mejora2, casa mejora3") para sacar más combinaciones visuales del generador. Sigue faltando aquí, sin diseñar: qué desbloquea la subida de nivel (tiempo/dinero/recursos), quién la paga, y el enganche real con el sistema de construcción/parcelas — hoy el nivel es solo un parámetro que alguien tendría que pasarle al generador, nada en el juego lo decide todavía.

## Proyectos especiales del jarl (edificios comunales) — mecanismo de construible IMPLEMENTADO (2026-08-30), contenido/servicio real de cada uno sin diseñar

Además de las parcelas normales de cada jugador, el **jarl/admin** de un asentamiento puede levantar "proyectos especiales": edificios ÚNICOS de beneficio comunitario (no de un jugador concreto), en parcela libre del asentamiento. Mismo mecanismo que "Taller de Máquinas de Asedio" (`GDD_Faccion_Bandidos.md` §8: un tipo de edificio más en `tipos_edificio.json`, restringido a `esJarl()` en la validación del servidor — ya existe ese check, se reusa tal cual) — la novedad es que hay VARIOS, no solo el de asedio, y cada uno da un servicio comunal distinto en vez de "fabricar máquinas".

**Cuenta de esta lista (2026-08-29): 14 proyectos** (8 en "Lista del streamer" + 6 en "Propuestas con utilidad concreta" de abajo) — es el número usado para dimensionar las "parcelas especiales reservadas" (14+2 de margen = 16) del nuevo tier `capital_jarl` en `docs/GDD_Ciudad_Capital.md`. Si esta lista crece o se filtra, ese `+2` de `ciudades/catalogo/asentamientos.json` (`capital_jarl.parcelasReservadas.especiales`) NO se actualiza solo — hay que revisarlo a mano.

**Lista del streamer**:
- **Taller de Asedio** — fabrica máquinas de asedio (catapulta/torre/ariete). Ya documentado en `GDD_Faccion_Bandidos.md` §8, con sus dependencias reales (generador de capital, construcción fuera del Hub, combate).
- **Baños Públicos** — servicio gratis de Comida/Bebida/Sueño/Salud para cualquiera del asentamiento. Encaje: consume directamente del "Sistema de personaje" (vitales ya HECHOS y jugables, ver arriba); sería el primer uso concreto de un edificio que RELLENA vitales en vez de solo alojar mobiliario decorativo — falta solo el edificio en sí, los vitales que consumiría ya existen de verdad.
- **Casino** — minijuegos de apuestas. Encaje: sumidero de dinero real para "Comercio y economía" (todo gold sink necesita un sitio) — con Twitch integrado más adelante, encaja de más con apuestas en vivo de los viewers (backlog "Modo Live").
- **Gran Catedral** — hito religioso/social del asentamiento. Sin mecánica cerrada; candidato natural a curación pasiva mejorada o bono de moral cuando exista ese sistema (ver "Curación pasiva vs activa distintas" en ideas propias, más abajo).
- **Estatua del Líder** — estatua del jarl/streamer. Puramente de hito/identidad visual — buen candidato a arte único generado por semilla del propio jarl en vez de placeholder genérico (mismo principio que "Objetos con nombre propio generado por semilla", ideas propias).
- **Establos Comunales** — almacenar monturas propias + comprar/vender nuevas. Encaje directo con "Monturas — sin diseñar" (más abajo) y con comercio.
- **Gran Herrería** — comunal: los herreros del asentamiento pueden forjar armas/armaduras ÚNICAS. Encaje: "Roles/profesiones y crafteo por planos" (arriba) + "Objetos con nombre propio generado por semilla" (ideas propias) para que lo forjado ahí salga con nombre/lore propio, no un ítem de catálogo genérico más.
- **Molino** — moler cosecha/flores. Encaje YA ANTICIPADO en el propio contrato de construcción: `GDD_Construccion.md` §3 reserva desde v1 un campo `energia: {consume}` / `{produce, fuente: "viento"|"agua"|"movimiento"}` en cualquier entrada de catálogo diciendo literalmente "los molinos del futuro serán entradas de catálogo, no reformas" — este es exactamente ese momento. Conecta además con "Injertos y cruces de cultivos" (grano→harina) y "Cocina" (harina→pan).

**Propuestas con utilidad concreta (a filtrar por el streamer)**:
- **Gran Mercado / Lonja** — plaza de comercio central del asentamiento con precios base propios, en vez de depender solo de la `tienda` individual de cada dueño de parcela. Ata directo a "Comercio y economía" (arriba, ya HECHO en lo esencial — esto seguiría siendo la pieza de precio-base-por-asentamiento que todavía no existe).
- **Ayuntamiento / Salón del Jarl** — sede de gestión: ver impuestos/renta (ya diseñado como v2 en `GDD_Construccion.md` §7) y asignar/revocar parcelas desde dentro del juego en vez de solo la herramienta admin — cierra directamente el pendiente "Jarl en juego pintando parcelas" de `GDD_Construccion.md` §8.
- **Cuartel de la Guardia Comunal** — entrena/aloja guardias del asentamiento para su propia defensa. Simétrico exacto al `campamento_hostil` de la facción bandida pero del lado del jugador — ata a "Facciones y la ciudad enemiga" y al sistema de combate, ya HECHO (ver arriba) — falta solo el edificio/guardias en sí.
- **Academia Arcana / Torre de Magos** — comunal, magos del asentamiento crean objetos/hechizos únicos. Mismo patrón que Gran Herrería pero para Ataque/Defensa mágica (ya en los atributos de personaje que definió el streamer) — hoy no hay ninguna estructura que use esa parte de las estadísticas; esta la cubriría.
- **Puerto/Muelle Comunal** — construir/reparar barcos y pesca a mayor escala que la individual. Ata a "Barcos y navegación marítima" (sin diseñar) y "Pesca" (ya HECHA, más abajo).
- **Gran Biblioteca/Archivo** — enseña planos/recetas raras que no se consiguen comprando. Ata directo a la pregunta abierta de "Roles/profesiones y crafteo por planos" (¿cómo se consigue un plano nuevo?) y a "Aprendizaje de recetas por relación con NPC" (ideas propias).

**Pendiente de decidir cuando toque**: el coste de material/tiempo de cada uno (probablemente escalonado, el Taller de Asedio y la Gran Catedral no cuestan lo mismo que un Molino — hoy son gratis como cualquier `construible` sin `receta`), y si dan beneficio a CUALQUIERA del asentamiento (vecino de cualquier parcela) o solo a quien tenga parcela propia asignada por el jarl. **Ya decidido e implementado (2026-08-30)**: tope de 1 por asentamiento, sí — ver `docs/GDD_Construccion.md` §1ter.

**Nota 2026-08-29**: el mobiliario/decoración temático de los 14 ya está en catálogo (`interiores/catalogo/elementos.json` y `exteriores.json`, ~20 piezas por edificio, ~280 entradas), con 10 salas nuevas propias en `interiores/catalogo/tipos_sala.json` para los que son claramente exclusivos (`taller_asedio`, `banos_comunales`, `gran_catedral`, `gran_herreria`, `sala_molino`, `salon_jarl`, `cuartel_guardia_comunal`, `academia_arcana`, `capitania_puerto`, `gran_archivo`) y 3 reusando una sala existente que no rompe tema con edificios normales (Casino → `sala_juegos`, Establos Comunales → `cuadra`, Gran Mercado/Lonja → `lonja`); la Estatua del Líder es puramente exterior (`exteriores.json`) y el Puerto/Muelle Comunal se reparte entre una sala pequeña de capitanía y el propio muelle exterior.

**HECHO (2026-08-30), ver `docs/GDD_Construccion.md` §1ter**: el mecanismo real de "proyecto especial del jarl" como `construible` ya existe — flag `proyectoJarl:true` (13 de los 14 en `tipos_edificio.json` con id propio: `taller_asedio`, `banos_comunales`, `casino`, `gran_catedral`, `establo_comunal`, `gran_herreria`, `molino_comunal`, `gran_mercado`, `salon_jarl`, `cuartel_guardia_comunal`, `academia_arcana`, `capitania_puerto`, `gran_archivo`; la Estatua del Líder en `exteriores.json`), validado por `validarColocacion()` (solo jarl, solo parcela `tipo:"especial"`, tope de 1 por asentamiento para el edificio — sin tope para las piezas decorativas sueltas de un mismo proyecto). Sigue SIN diseñar, como antes: el tope de 1 por asentamiento QUEDÓ decidido (sí, hay tope) al implementar esto; el coste de material/tiempo de cada uno; y a quién beneficia (cualquiera del asentamiento o solo quien tenga parcela propia) — eso depende de sistemas que no existen todavía (vitales-desde-edificio para Baños, economía para Casino/Gran Mercado, crafteo por planos para Gran Herrería/Academia Arcana/Taller de Asedio).

## Sistema de personaje — HECHO (2026-08-29/30): vitales, atributos, fórmulas y equipo real ya cerrados y verificados

Primer boceto de qué estadísticas tiene un jugador (el streamer las dio, aquí solo se ordenan). Recordar el principio ya fijado: inventario y equipo son autoritativos en servidor, el cliente solo predice/muestra (ver conversación de arquitectura general).

**Vitales** (se degradan/regeneran con el tiempo y las acciones, base de la "simulación de vida"):
- Vida, Comida, Bebida, Sueño, Estamina.
- Defensa física, Defensa mágica, Ataque físico, Ataque mágico — estas dos últimas parejas son más "de combate" que "vitales", pero el streamer las agrupó con el mismo mecanismo: **todas modificables por consumibles, objetos, armaduras y armas** (un vital como Comida sube al comer; un vital como Defensa física sube al llevar una armadura puesta — mismo tipo de modificador aplicado a cosas distintas).

**Atributos** (lista original del streamer: fuerza, inteligencia, destreza, sigilo, carisma, liderazgo — **revisada 2026-08-30, ver `docs/GDD_Personaje.md` §3**: `liderazgo` sale, entra `resistencia`; `sigilo` se retira entero (sin sistema al que engancharlo) y `comercio` se fusiona dentro de `carisma`; lista final de 5: fuerza, destreza, inteligencia, resistencia, carisma):
- Cada uno con sus propias especificaciones y bonus (qué desbloquea/mejora cada uno — pendiente).
- Valor de partida: unos base, con matiz para cuando exista el creador de personaje del jugador (`personajes/` ya genera la ficha física/morfología por semilla — la generación de ATRIBUTOS de un PJ elegido por un jugador de verdad es otra cosa, distinta de un NPC aleatorio; falta decidir si el jugador reparte puntos, si nacen fijos según algo que elige, o una mezcla).
- Mejoran (o empeoran) **según uso/experiencia**, no un nivel global — encaja con el patrón ya usado en oficios (ver abajo) y evita un "sube de nivel y repartes puntos" genérico. Sin cerrar: la fórmula de progreso, si hay deterioro real por desuso prolongado, y el tope máximo de cada atributo.

**Peso transportable e inventario** (el punto que más detalle trajo el streamer, ver sección propia más abajo).

**Esqueleto aplicado (2026-08-29, docs/GDD_Personaje.md)**: los 5 vitales de "simulación de vida" (vida/comida/bebida/sueño/estamina, decaimiento en horas reales sin tick nuevo) y los 6 atributos (XP igual que oficios, curva de nivel compartida en `server/src/progresion/nivel.ts`) ya están en `Player` y verificados con servidor real. Ataque/Defensa NO se duplican aquí — siguen siendo stats de arma/armadura en `items.json`, a combinar con atributos ahora que Combate ya existe (ver sección de arriba).

**HECHO (2026-08-29/30) — las fórmulas que quedaban pendientes ya están cerradas y en uso real**: `pesoMaximoTransportable`, `vidaMaximaPorResistencia`, `paMaxPorDestreza`, `factorVelocidadCrafteo` (todas en `server/src/progresion/` e importadas en `RoomExteriorBase.ts`) resuelven Fuerza→peso, Resistencia→vida máx, Destreza→PA de combate, y el resto de bonus por atributo. Slots de equipo reales y jugables — no solo diseñados — ver `docs/GDD_Equipo.md`: 19 slots (`equiparItem`/`desequiparItem`), con UI (`client/src/personaje/panelJugador.ts`) y render sobre el rig (`client/src/render3d/equipoVisual.ts`).

**Corrección (2026-08-30): la persistencia entre sesiones es más completa de lo que decía este backlog** — vida/vidaMax SÍ persiste (`bd.ts::actualizarVidaJugador`, cargada al hacer join en `HubRoom.ts`) y los atributos también persisten vía su XP acumulada (tabla `jugador_atributos`, `obtenerXpAtributo`/`sumarXpAtributo`) — igual que inventario/equipo. Lo único que de verdad NO persiste, por diseño explícito, son los vitales de simulación de vida más rápidos (hambre/sed/sueño/estamina — "viven y mueren con la sesión"). Penalizaciones exactas por vitales a 0 siguen pospuestas.

## Inventario, contenedores y objetos en el mundo — fases 1 y 2 HECHAS (catálogo + servidor + persistencia + "coger del mundo"), solo la interfaz de rejilla arrastrable (fase 3) sigue pendiente

**Actualización 2026-08-29**: catálogo (`items/catalogo/items.json`, 55 ítems), lógica de rejilla pura (`server/src/inventario/inventario.ts`, 15 tests), persistencia dual SQLite/Postgres (`inventarios`/`equipo` en `server/src/datos/bd.ts`, 13 tests) y Schema de Colyseus (`Player.inventario` en `HubState.ts`) ya construidos y verificados — contrato completo en `docs/GDD_Inventario.md`. Varias de las preguntas "pendiente" de abajo ya se resolvieron ahí (rejilla independiente por contenedor, no anidada; rotación 0/1, no 0/90/180/270).

**HECHO (2026-08-29) — fase 2, "coger del mundo"/soltar, ver `docs/GDD_Inventario.md` §7**: `server/src/inventario/cogerSoltar.ts::intentarCoger`, todo-o-nada, enganchado a los recolectables reales del mundo (`server/src/mundo/recolectables.ts`). **Lo único que sigue abierto es la fase 3**: hay un panel de cliente funcional (`client/src/personaje/panelJugador.ts`) pero no es una rejilla arrastrable de verdad (drag&drop, rotar, previsualizar) — sigue siendo interfaz sin diseñar en ese sentido concreto.

Concepto decidido por el streamer, estilo Project Zomboid:

- **Peso y espacio son EJES DISTINTOS**: todo objeto pesa (cuenta contra el "peso transportable" del personaje, ligado a Fuerza) Y ocupa espacio en el inventario (independiente del peso). Un objeto pesado y pequeño (un lingote de oro) y uno ligero y grande (una escalera) estresan ejes distintos del inventario.
- **Inventario en rejilla estilo "tetris"**: cada objeto tiene una huella 2D (su representación plana, o una vista fija del modelo 3D) que hay que encajar en la cuadrícula — no una lista con cantidad, hueco físico real.
- **Contenedores**: además de los fijos del mundo (cajas, cofres — ya existen como mobiliario de saqueo en `interiores/catalogo/elementos.json`, con `lootTier` en las piezas de mazmorra), el personaje puede llevar mochilas/bolsos/bolsillos que AMPLÍAN su cuadrícula de inventario — cada contenedor con su propia rejilla (¿anidada dentro de la del cuerpo, o independiente?, pendiente).
- **Objetos sueltos en el mapa**: se pueden dejar en el suelo y se ven en su sitio real en 3D (no un icono) — ya hay precedente exacto de esto en el propio bakeador: los "objetos sueltos de superficie estilo Project Zomboid" que coloca `interiores/catalogo/elementos.json` (`colocacion: sobreSuperficie`, ver más abajo en este mismo backlog, sección "Menú de construcción/decoración") son la misma idea aplicada a contenido bakeado en vez de soltado por el jugador — coherente reusar el mismo concepto de anclaje/colisión.
- **Zonas prohibidas para soltar objetos**: alguna zona del mapa no dejará colocar nada (a marcar más adelante — ¿parcelas ajenas? ¿interior de mazmorra? pendiente).
- **Sistema de carga** (llevar/arrastrar algo pesado, o cargar un objeto en brazos bloqueando otras acciones) — mencionado, sin diseñar cómo se implementa.

**Pendiente de definir cuando toque**: tamaño de la rejilla base del personaje, cómo escala el tamaño de la rejilla de cada contenedor (mochila pequeña vs baúl), si rotar un objeto en la rejilla es una mecánica (como el Tetris real) o los objetos tienen forma fija, cómo se sincroniza servidor-autoritativo sin lag perceptible al arrastrar objetos, y si coger un objeto del suelo tiene un radio de interacción o hay que "abrirlo" como un contenedor.

## Roles/profesiones y crafteo por planos — mecanismo HECHO (2026-08-29, ver "Oficios de crafteo" arriba), árbol de recetas por oficio sigue pendiente

- Cada profesión permite ciertos crafteos, desbloqueados por **planos** ("blueprint") — no todo el mundo craftea todo desde el principio.
- Progresión por **rama/experiencia de la propia profesión** (mejora de herrero, mejora de carpintero...) — mismo patrón "se mejora con el uso" que los atributos de arriba, no un nivel de personaje genérico compartido.
- Encaja directo con "Oficios de crafteo" y "Comercio y economía" ya anotados más abajo en este backlog — mismo tema, ahora con el mecanismo (planos + XP por rama) más claro.

**Catálogo de profesiones — lista CERRADA en cuanto a nombres/orden de prioridad (pactado con el streamer 2026-08-29), sigue siendo una lista ABIERTA en el sentido de CLAUDE.md §7 ("las listas CRECEN") si aparece una profesión nueva más adelante. Lo que SIGUE sin diseñar para cada una: árbol de planos/recetas, qué objetos/herramientas salen de cada receta, y la estación/ubicación exacta donde se craftea — eso se define oficio a oficio cuando le toque el turno, no de golpe.**

Orden de prioridad, de más a menos infraestructura ya construida detrás:

- **Tier 1 — su mesa YA tiene el gancho `energia` de Motriz puesto (docs/GDD_Motriz.md), cero trabajo de conexión pendiente**: herrería (general, yunque), carpintería (sierra_grande), alfarero (torno_alfarero).
- **Tier 2 — edificio + oficio NPC ya existen (`poblacion/catalogo/oficiosEdificios.json`) Y cierran un bucle de recurso que el servidor YA produce de verdad**: apicultor (colmena de Producción ya genera miel/cera en vivo), molinero (el molino de Motriz es literalmente su estación; grano→harina), panadero (consume la harina del molinero, `panaderia` ya existe), curtidor (piel→cuero, `curtiduria` ya existe).
- **Tier 3 — edificio + oficio NPC ya existen, sin bucle de recurso previo pero sin nada más que inventar de infraestructura**: joyero (`joyeria`), sastre/tejedor (`taller_sastre` — solapa con lo que `ropa/` ya genera proceduralmente, hay que decidir el reparto cuando toque), tendero (ya ES Mercado, falta decidir si "vender" en sí lleva progresión de oficio), tabernero (`taberna`/`posada` ya con oficio NPC — no estaba en la lista original del streamer, se añade aquí por tener la misma infraestructura ya lista que tendero).
- **Tier 4 — recolección primaria: alimentan a los oficios de arriba, pero necesitan nodos/mecánica de recolección nueva en el bake que hoy no existe**: minero (vetas de mineral/piedra — alimenta a herrero y picapedrero), leñador, montar a caballo (y otras monturas). **Agricultura y pesca YA HECHAS** (2026-08-30, `docs/GDD_Agricultura.md`/`docs/GDD_Pesca.md`) — no dependían del bake exterior, se resolvieron con construcción de parcela + inventario + cálculo perezoso. **Caza (con desollado/encurtido) y cría de animales YA HECHAS** (2026-08-30, `docs/GDD_Caza.md`/`docs/GDD_Ganaderia.md`) — trampero (pieles para peletero) queda cubierto por el desollado de la caza, no como oficio de recolección aparte.
- **Tier 5 — sin building en catálogo todavía, o dependen de sistemas que no existen (combate, heridas, barcos)**: herrero de armas, herrero de armaduras (subdividir herrería general — necesita equipables reales), tallador de piedra/picapedrero, peletero, herbolista, vidriero, arquero/ballestero (fletcher), guarnicionero (sillas/arreos — detrás de "montar a caballo"), destilador/cervecero, constructor, cocinero, carnicero, curandero/médico (`choza_curandero` ya existe; distinto de herbolista — trata heridas, conecta con "heridas como estado" en "Ideas propias a valorar"), mercader ambulante (`carromato_mercader` ya existe), navegante, capitán de barco, constructor naval/carpintero de ribera (conecta con "Puerto/Muelle Comunal"), guardia/mercenario (`cuartel_guardia`/`arena_combate` ya existen sin profesión encima), explorador/cartógrafo (`mapa_mesa` ya existe).

**Pendiente de definir cuando toque, oficio a oficio**: cómo se consigue un plano nuevo (comprado/encontrado/enseñado por NPC), recetas/objetos/herramientas concretos, y si un personaje puede tener varias profesiones a la vez o hay que especializarse. Recomendación (no decidida): empezar por el Tier 1+2 completo (7 oficios) antes de tocar Tier 4/5 — cierra Producción→Motriz→crafteo→Mercado con lo ya construido, sin abrir combate/heridas/minería todavía.

**Edificio/mesas/mobiliario por oficio — aplicado al catálogo (2026-08-29)**: `docs/GDD_Profesiones.md` fija, para los 38 oficios, el edificio, 2-4 mesas especiales y únicas por oficio (básica→avanzada, marcando cuáles conectan a la red motriz), mobiliario funcional/decorativo, y el NPC de oficio. Ya en `main`: 50 mesas/mobiliario + 8 edificios nuevos + 8 NPCs de oficio + su enganche a `poblacion/` y a los bakes de `ciudades/` — verificado con bakes de prueba reales.

**Corrección (mismo día, 2026-08-29): el mecanismo de planos+recetas YA no está sin diseñar** — ver la sección "Oficios de crafteo" de arriba (`docs/GDD_Crafteo.md`): planos (`planoRequerido`), nivel mínimo de oficio, y XP por rama, con un ejemplo real cerrado (`espada_hierro_basica`). Lo que sigue pendiente es solo volumen: rellenar recetas concretas para las ~38 profesiones, oficio a oficio.

## NPCs contratables para automatizar producción (trabajar, transportar, vender) — la pieza de TRANSPORTE ya HECHA (2026-08-29), automatizar trabajo en granja/mesa sigue sin construir

Pedido del streamer (2026-08-29): el menú de construcción no es solo bloques/muebles/decoración sin interior + edificios pequeños con interior (ver `GDD_Construccion.md` §8) — la otra mitad es aprovechar el pathfinding ya construido para AUTOMATIZAR trabajo contratando NPCs con dinero: un NPC que trabaje una granja/mesa y guarde el material en las cajas de la parcela, otro que transporte materiales de un punto A a un punto B (venderlos, o llevarlos a otra parcela propia donde se transforman en otro material vía crafteo — ej. harina→pan en una panadería), contratado desde una mesa/edificio específico hablando con un NPC "reclutador" (tipo oficina de empleo).

**Encaje con lo que ya existe**:
- `server/src/mundo/agentes.ts` YA separa el "cuerpo" del agente móvil (autómata QUIETO/VIAJANDO por polilíneas bakeadas) del "cerebro" (hoy: rutina horaria de `poblacion/`; el propio comentario de cabecera anticipa "merodeo y patrulla llegarán como cerebros nuevos sobre este mismo cuerpo"). Un "trabajador contratado" es un TERCER cerebro sobre el mismo cuerpo: en vez de rutina o patrulla, sigue un contrato (ir a A, trabajar/recolectar, ir a B, dejar/vender, repetir).
- El "reclutador" es un rol de NPC más (como `vagabundo`/`chismosa` en `poblacion/catalogo/especiales.json`), con un modo de diálogo NO libre (menú de contratación) sobre el sistema de IA de NPCs que YA existe (`server/src/ia/`, mensaje `npc:hablar`) — mismo patrón que tendrá el líder bandido con su propio prompt (`GDD_Faccion_Bandidos.md` §1), no una tubería de diálogo nueva.
- Recolectar/almacenar reutiliza directo "Recolectables con pool de puntos de spawn" (bakeador ya cerrado) para lo silvestre y "Injertos y cruces de cultivos" (diseño ya cerrado) para granjas — un NPC contratado "trabajando la granja" es mecánicamente el mismo recolector que ya usaría un jugador, solo que automatizado. Las cajas de almacén son contenedores de "Inventario, contenedores y objetos en el mundo" (esqueleto ya estructurado, más abajo).

**La fricción real: el pathfinding en vivo nunca hace A\* en el tick.** Regla ya fijada en `agentes.ts` (motivo: coste en un server gratuito de Render) — solo se anda por rutas BAKEADAS offline entre puntos que el bakeador ya conocía; si falta, TELEPORT. Una parcela construida por un jugador hoy no existe en ese momento del bake, así que no hay ruta pre-calculada entre "mi granja" y "mi panadería" en otra parcela.

Cómo encaja SIN romper la regla: lo que está prohibido es A\* REPETIDO en el tick, no A\* alguna vez. Mismo patrón que ya usa `interiorGenerado.ts` (genera el interior de un edificio construido UNA VEZ, al construirlo, no cada tick): calcular la ruta del contrato UNA VEZ, al firmarlo (o al construir el segundo punto si faltaba), contra la rejilla ya construida del mapa+parcelas, y cachearla (mismo campo tipo `camino` que ya usan los `TramoRutina`, o el `extra` de `construcciones`). Si el jugador mueve algo de en medio después, se recalcula UNA VEZ en ese momento — coherente con "generar una vez, nunca en directo", no una excepción.

**Qué falta antes de poder implementarlo (dependencias reales, en orden — actualizado 2026-08-30, ver más abajo qué ya se resolvió)**:
1. ~~Dinero/economía~~ — **HECHO**, ver "Comercio y economía" más abajo (Farycoins real).
2. Inventario/objetos en el mundo — contenido real de las cajas, no solo el mueble placeholder de hoy (backlog "Inventario, contenedores y objetos en el mundo", fases 1-2 ya hechas — falta el contenido real de las cajas en sí, no el mecanismo).
3. ~~Oficios de crafteo con recetas+estación reales~~ — **HECHO el mecanismo**, ver "Oficios de crafteo" arriba; falta solo volumen de recetas.
4. Edificios pequeños de construcción propios (mesa/oficina de reclutamiento — ver `GDD_Construccion.md` §8).
5. ~~Un A\* de caminos reusable EN RUNTIME~~ — **HECHO**, ver `server/src/mundo/pathfindingRuntime.ts::calcularCaminoRuntime`.

**Progreso real (2026-08-29), pieza de TRANSPORTE ya construida — ver `docs/GDD_Produccion.md`**: `transporte:contratar` en `RoomExteriorBase.ts`, tabla `contratos_transporte`, NPC carretero visible vía `GestorAgentes.agregarAgenteTransportista`, ruta calculada UNA VEZ al firmar el contrato (coherente con "nunca A* en el tick", exactamente como proponía este backlog). Lo que sigue sin construir es la otra mitad: un NPC que "trabaje" una granja/mesa de verdad — hoy sigue siendo un flag abstracto (`trabajadorAsignado: boolean`), no un NPC contratado real — y el reclutador/oficina de empleo.

**Pendiente de decidir cuando toque**: si el NPC contratado sale de un pool de "desempleados" (ej. `vagabundo` reconvertido) o cualquier NPC del asentamiento puede aceptar; si el contrato se paga una vez o es sueldo periódico (mismo patrón de tick que `ejecutarTickEconomia` de la facción bandida); qué pasa si el punto B no tiene hueco/capacidad.

## Ideas propias a valorar (propuestas, no decisiones — para que el streamer las filtre)

Pensando en qué encaja con lo que ya existe en el proyecto (rig con pivotes por zona, ropa con fibras textiles, ciclo día/noche recién construido, ciudad neutral/hostil, roles de Twitch ya decididos):

- **Heridas/enfermedad como estado, no solo daño plano**: sangrado (dot), fractura (penaliza velocidad/Estamina hasta curar), infección de una herida sin tratar, envenenamiento — le da un uso mecánico real a `choza_curandero` (ya existe como tipo de edificio) y a una futura profesión de medicina/alquimia (`sala_alquimia` también ya existe en mazmorras).
- **Temperatura personal**: frío en `montana_nevada`, calor en `desierto` (ambos biomas ya generados por el bakeador) — la ropa (`ropa/`, que YA sabe qué fibra es cada prenda: lino/lana/seda) protege según el material, no solo por defensa física. Conecta ropa, clima y vitales en un solo sistema sin inventar catálogos nuevos.
- **Zonas de golpe por parte del cuerpo**: el rig humanoide YA cuelga piezas de cabeza/torso/brazos/piernas por separado (mismos pivotes que usa `ropa/`) — un golpe a la cabeza sin casco pesa distinto que uno al torso con armadura. Encaja con el sistema de ataque/defensa sin inventar un esqueleto nuevo.
- **Sigilo real, no solo un número**: ligarlo al cono de visión de NPCs (ya anotado más abajo, "Cono/campo de visión real en interiores") y al ciclo día/noche (ya construido, `cicloDia.ts`) — de noche o agachado entre sombras, el atributo Sigilo pesa más. Mismo principio en exteriores con la vegetación densa como cobertura.
- **Deterioro por desuso, no solo mejora por uso**: si un atributo/habilidad de profesión baja un poco tras mucho tiempo sin practicarse, la simulación de vida pesa más y hay más razones para variar lo que hace el personaje (coherente con lo que ya insinuó el streamer: "mejorados O EMPEORADOS según sus acciones").
- **Durabilidad de equipo**: armas/armaduras/herramientas se desgastan con el uso y necesitan reparación — le da trabajo constante a los oficios de crafteo en vez de craftear una vez y listo, y una razón económica más para el comercio.
- **Reputación por facción/asentamiento**: con ciudad neutral y ciudad hostil ya decididas (ver "Facciones y la ciudad enemiga" abajo), Carisma/Liderazgo podrían mover precios de mercader, si un guardia te deja pasar, o si un asentamiento hostil te ataca a la vista o no.
- **Liderazgo con efecto de grupo real**: bonus a mercenarios/mascotas domesticadas o a jugadores cercanos en el mismo grupo/gremio — le da un uso concreto a un atributo que si no queda decorativo comparado con Fuerza/Destreza.
- **Roles de Twitch como modificador de estas mismas estadísticas**: ya está decidido que sub/mod/VIP dan ventajas (ver "Roles de Twitch" abajo) — encaja aquí como espacio extra de inventario, regen de Estamina/Sueño más rápida, o similar, en vez de un sistema de ventajas totalmente aparte.
- **Muerte**: qué pasa con el inventario en rejilla al morir — ¿bolsa de loot en el sitio exacto donde cayó (coherente con "objetos en el mundo" de arriba), recuperable solo por quien la encuentre? Conecta directo con "Muerte y respawn" ya anotado abajo.
- **Sobrepeso escalonado, no un corte binario**: ligero/normal/cargado/sobrecargado, cada tramo penaliza más velocidad y gasto de Estamina — más natural que "puedes cargar / no puedes cargar" a secas.
- **Curación pasiva vs activa distintas**: la Vida se regenera sola muy despacio (o nada) solo con Comida/Bebida/Sueño cubiertos; curación de verdad requiere vendaje/poción/curandero — evita que la vida se cure sola sin más, que suele romper el sentido del combate.
- **Muerte con margen, no game over instantáneo**: Comida/Bebida/Sueño a 0 hacen daño progresivo a Vida en vez de matar directo — da tiempo a reaccionar (volver a la aldea, comer) en vez de un cero brusco.
- **Borrachera/estados por consumible con efecto mixto**: alcohol (ya hay `taberna`) sube Carisma/regen social un rato pero baja Destreza/precisión — primer consumible con efecto doble, no solo "sube un número".
- **Vínculo con montura/mascota domesticada**: sube junto con el jugador (confianza/nivel propio), no un objeto estático — le da peso real a domesticar en vez de ser solo transporte.
- **Objetos con nombre propio generado por semilla**: un arma/armadura "especial" (de jefe de mazmorra, por ejemplo) sale con nombre + pequeño lore generado, igual que ya generamos NPCs/animales por semilla — encaja con "todo lo procedural tiene ficha" sin escribir historias a mano.
- **Aprendizaje de recetas por relación con NPC**, no solo comprando el plano — un curandero/herrero con buena reputación te enseña algo que no vende a cualquiera; conecta reputación + profesiones + los NPCs con IA que ya están en el backlog.
- **Clima afectando mecánicas, no solo estética**: lluvia moja (apaga antorchas al aire libre, ropa mojada = más frío), nieve en `montana_nevada` con daño por frío sin abrigo adecuado — todo esto ya tiene datos base (biomas, ropa por fibra) para engancharse sin catálogos nuevos.

## Muerte y respawn — HECHO (2026-08-30)

Respawn en la cama de una propiedad propia si existe, si no en el Hub; -20% de durabilidad al equipo, el resto del inventario cae al suelo en el sitio de la muerte. Ver `docs/GDD_Muerte_Respawn.md`.

## Monturas — HECHO (2026-08-30)

Domesticación (mismo mecanismo que perro/gato, ahora también en el Hub/exterior salvaje, no solo en aldeas), silla de montar como ítem que se le pone a una mascota propia, montar/desmontar (jugador+montura fusionados en una sola entidad física, velocidad real del catálogo de rig), salto corto, desmonta forzoso antes de combate. Ver `docs/GDD_Monturas.md`. **Corrección (2026-08-30): el alcance es mayor de lo que decía esta entrada** — el protocolo (`mascota:montar/desmontar`, `montura:saltar`) vive en `RoomExteriorBase.ts`, la clase base de la que heredan tanto `HubRoom` como `RegionRoom`, así que ya funciona en ambas, no solo en el Hub. Verificado con E2E real contra servidor Colyseus levantado (`server/test/monturas.e2e.mjs`).

## Pesca — HECHO (2026-08-30)

Activa (caña + cebo, orilla, boya con ventana de reacción a la picada) y pasiva (trampa/cangrejera/batea de almejas, producción pasiva reusando el mismo mecanismo de colmena/aserradero). Ver `docs/GDD_Pesca.md`. Sin distinción de bioma de agua por casilla todavía (agua dulce vs. mar) — tabla de capturas genérica hasta que el runtime lea bioma de agua.

## Barcos y navegación marítima — sin diseñar

Construcción de barco, navegar el mar (ya establecido como navegable, con fondo marino investigable como capa aparte), cargar mercancía, descubrir islas, cruzar a otro mapa por un borde de mar abierto.

## Comercio y economía — HECHO (2026-08-29/30) en lo esencial: moneda real, tenderetes y comercio jugador-jugador

Moneda, mercaderes NPC (los que ya aparecen en plantillas de POI como "oasis_mercader"), compraventa entre jugadores, si hay fluctuación de precios.

**HECHO — moneda real**: `Farycoins` (columna `jugadores.farycoins`, ajuste atómico vía `ajustarFarycoins`). **HECHO — comercio jugador-jugador**, ver `docs/GDD_Comercio.md`: `ComercioSchema`/`OfertaComercioSchema` en `HubState.ts`, mensajes `comercio:solicitar/ofrecer/confirmar/cancelar` (tecla T, apertura mutua, todo-o-nada, ahora también con animales de granja — `docs/GDD_Ganaderia.md`). **HECHO — tenderetes de jugador**, ver `docs/GDD_Mercado.md`: `comprarDeTenderete`/`reponerStockTenderete`/`fijarPrecioTenderete`, tabla `tenderete_items`, protocolo `tenderete:*`. **Sigue sin construir**: fluctuación automática de precios (el vendedor fija su precio libremente, sin `precioBase` de catálogo que suba/baje solo) y una economía real de mercaderes NPC (los de POI siguen siendo flavor, sin inventario/precio dinámico).

## Gremios / equipos — HECHO (2026-08-29) el núcleo, parcelas/construcción compartida sigue sin diseñar

Parcelas compartidas de gremio (mencionado ya en la arquitectura general del proyecto), roles dentro del gremio, construcción colaborativa.

**HECHO, ver `docs/GDD_Gremios.md`**: `server/src/gremios/{gremios,contextoGremios}.ts` (`GremioVivo`, `ContextoGremios`), tablas `gremios`/`gremio_miembros`/`gremio_invitaciones`, mensajes `gremio:fundar/invitar/expulsar/depositar/retirar/actualizar` en `RoomExteriorBase.ts`. Banco común, roles (líder/miembro), emblema/color de catálogo cerrado — todo ya jugable. **Sigue sin diseñar, explícito en el propio GDD §7**: no hay parcelas ni propiedades a nombre del gremio, toda propiedad hoy es de un jugador individual — "construcción colaborativa" real sigue pendiente.

## Roles de Twitch dentro del juego — HECHO v1 (2026-08-30) para lo cosmético, sin ventaja de poder por decisión explícita

Ya está decidido que el login es OAuth de Twitch y que sub/mod/VIP dan ventajas dentro del juego (una de las 5 decisiones fundacionales del proyecto) — falta decidir qué ventaja concreta da cada rol.

**HECHO, ver `docs/GDD_Twitch.md` ("v1 implementada y verificada")**: títulos por rol (jarl/mod/sub/seguidor) y comandos de chat (`!curar`/`!comer`/`!beber`/`!cagar`) disponibles para cualquier jugador conectado, más 9 eventos de puntos de canal con efecto cerrado. **Corrección real de diseño, no un pendiente**: el propio GDD marca los títulos como **explícitamente cosméticos** ("nunca ventaja de poder", §2) — se decidió deliberadamente NO dar ventaja diferenciada de poder por sub/mod/VIP, así que esta pregunta ya no está "sin definir", está resuelta en sentido contrario al que planteaba este backlog.

## NPCs Gobernadores con IA — diálogo genérico con IA HECHO (2026-08-30), el concepto específico "Gobernador" (3-4 NPCs con misiones por economía) sigue sin construir

Ya está decidido el modelo híbrido: NPCs base con IA simple/rutinas, y 3-4 NPCs "Gobernador" con integración LLM en tiempo real que generan misiones según la economía de la ciudad y responden al chat. Falta definir cómo mantienen memoria de conversación, límites de coste/latencia, y el contexto exacto que reciben.

**HECHO, ver `docs/GDD_IA_NPCs.md`**: diálogo real con IA (Gemini/Groq con fallback, memoria RAG casera anti-repetición) — pero aplicable a CUALQUIER NPC del catálogo con contexto de mundo placeholder, no el concepto específico de "Gobernador". El propio GDD lo deja explícito: "sistema de jarl por mapa/isla, aún sin construir", sin generación de misiones según economía. No existe ningún NPC "Gobernador" en catálogo/código todavía.

## Modo Live — eventos de Twitch en tiempo real — mapeo HECHO (2026-08-30), conexión real a Twitch (EventSub) sigue pendiente

Ya está decidido que cuando el streamer está en directo, eventos de Twitch (subs, bits, raids) generan eventos en el mundo (clima, spawns de recursos, hordas). Falta el mapeo concreto: qué evento de Twitch dispara exactamente qué efecto y con qué intensidad.

**HECHO, ver `docs/GDD_Twitch.md` §3**: mapeo concreto ya cerrado — 9 eventos de puntos de canal, cada uno con su efecto/duración/intensidad exacta. **Sigue pendiente**: hoy solo se dispara vía `twitch:simularCanje` (jarl-only, de prueba) — la conexión real a canjes/bits/subs de Twitch de verdad (EventSub) espera a que el streamer autorice OAuth (§0.3, §6 del propio GDD).

## Facciones y la ciudad enemiga — bandidos/conquista mayormente HECHO, asedio bloqueado ahora solo por crafteo por planos

Ya está decidido que hay una ciudad neutral y una ciudad enemiga en el mapa. Falta diseñar reputación, conflicto entre ambas, y si el jugador puede elegir bando o interactuar con la facción enemiga de alguna forma.

**Nota 2026-08-29**: la parte de "aldea/castillo bandido con economía viva + líder IA + conquista al matar a la última tropa" YA está diseñada y en buena parte construida — ver `docs/GDD_Faccion_Bandidos.md`. Lo que falta y sigue en este backlog es el paso ANTES de poder atacar: **asedio** (la entrada está bloqueada hasta romperla con máquinas de asedio construidas por el jarl en un Taller de Máquinas de Asedio, en la ciudad capital del jugador).

**Actualización 2026-08-30 — dos de los tres bloqueos originales YA están resueltos, y el combate (el tercero) también**: (a) el generador de ciudad capital — **HECHO**, tier `capital_jarl` con parcelas reservadas, ver `docs/GDD_Ciudad_Capital.md`; (b) construcción/parcelas fuera del Hub — **HECHO**, `docs/GDD_Construccion.md` §1bis extiende el sistema a cualquier `RegionRoom` con `parcelasReservadas`; (c) el sistema de combate — **HECHO**, ver la sección "Combate" de arriba. El bloqueo real que queda, según el propio `docs/GDD_Ciudad_Capital.md` §6, es uno que este backlog no tenía anotado: **crafteo por planos** para el Taller de Asedio (fabricar las máquinas en sí) — y la mecánica concreta de "romper la entrada/matar la guarnición para poder conquistar" (`marcarTropaMuertaYVerificarConquista` no comprueba todavía si la entrada está abierta) sigue sin construirse, ver `docs/GDD_Faccion_Bandidos.md` §8.3.

## Ideas propias para profundidad/diversión del MMO (propuestas, no decisiones)

Ya no son mecánicas de personaje sueltas, sino cosas a nivel de servidor/comunidad que dan una razón para quedarse jugando — pensadas para enganchar con lo que ya está decidido (Modo Live, NPCs Gobernadores, facciones, construcción):

- **Bosses de mundo abierto, no solo en mazmorra**: aparecen en el mapa exterior con aviso previo, necesitan varios jugadores a la vez, loot único — el momento "todo el chat corre hacia el mismo sitio".
- **Eventos dinámicos si nadie interviene**: una mazmorra sin limpiar mucho tiempo "se derrama" (enemigos aparecen cerca de su entrada, o migran), una aldea sin defender puede acabar asediada por la hostil — el mundo reacciona a la inacción, no solo a la acción del jugador.
- **Progresión visible de la propia aldea/parcela**: si el jugador prospera, su construcción sube de tier de verdad (más edificios, mercaderes que se instalan solos) — le da un objetivo a largo plazo a construcción, que hoy es solo "poner cosas".
- **Rutas comerciales entre aldeas con riesgo real**: escoltar una caravana de mercancía de un pueblo a otro, con posibilidad de asalto de bandidos — mezcla economía + PvE + cooperación en una sola mecánica.
- **Modo Live con efecto PERSISTENTE, no solo temporal**: además de los efectos temporales ya decididos (clima, spawns, hordas), que algunos eventos grandes de Twitch generen algo que se queda para siempre (una donación grande desbloquea una mazmorra nueva permanente en el mapa) en vez de solo un buff de 10 minutos — que el directo deje huella real en el mundo.
- **Contratos dinámicos según la economía del pueblo**, no misiones fijas: si falta madera, un NPC pide leñadores con recompensa; si sobra, baja el precio solo — le da a los NPCs Gobernadores con IA (ya decididos) algo concreto que ofrecer.
- **Niebla de guerra COMPARTIDA por servidor**: el mapa se revela según lo exploran entre todos, no cada jugador por separado — fomenta que alguien explore para el resto.
- **Minijuego de oficio, no menú de crafteo**: herrería con timing (golpear en el momento justo), pesca con tensión de caña — el crafteo se vuelve una habilidad que se nota, no un clic.
- **"Leyenda viva" del servidor**: quien mate un boss único o logre algo raro queda registrado (un NPC Gobernador lo menciona, una estatua/placa en la ciudad) — la comunidad se entera de las hazañas del resto sin salir del juego.

## Cono/campo de visión real en interiores — HECHO (2026-08-30), granularidad de sala completa

Al bocetar el bakeador de interiores salió la idea de un cono de visión calculado geométricamente (qué parte de una sala contigua ve el jugador a través de un hueco de puerta, recortado a la silueta real de la abertura en proyección isométrica). Confirmado explícitamente: **esto no es tarea del bakeador** — el bakeador solo genera la estructura estática (salas, paredes, huecos, mobiliario). El campo de visión es cálculo en vivo del cliente/servidor de juego, ligado a posición y orientación del jugador en cada instante, así que pertenece a la fase de "servidor en vivo" (como el clima o las sombras en exteriores). Apuntado aquí para no perder la idea ni el porqué (en proyección en paralelo/isométrica sin fuga de perspectiva, la silueta de lo visible a través de un hueco es idéntica a la silueta del propio hueco, sea cual sea la profundidad — más simple de calcular que en perspectiva real).

**HECHO (2026-08-30), 100% cliente, ver `client/src/render3d/conoVision.ts` y `docs/GDD_Sistema_Puertas.md`**: con la cámara isométrica FIJA del juego, las paredes este/sur de cualquier sala son SIEMPRE las que dan a cámara (no depende del jugador) — lo que sí depende de él es dónde se aplica el recorte: se oculta la sala que pisa, y en cascada a través de una puerta en su pared norte/oeste hacia la sala contigua (exactamente el principio de "silueta = hueco" citado arriba, reducido a "¿hay puerta norte/oeste desde la sala del jugador?" gracias a que la dirección de cámara es constante). **Granularidad de sala completa** — no recorta solo la porción visible de una sala grande a través de un hueco estrecho; eso queda como refinamiento futuro si hiciera falta.

## Luz ambiente por hora del día en interiores — HECHO (2026-08-30)

Al diseñar la capa de iluminación del bakeador de interiores salió la idea de que la luz que entra por una ventana dependa de la hora del día (de noche no entra nada, o solo un poco de luz de luna; de día entra una cantidad según la hora) y de que una sala sin ventana nunca reciba luz ambiente. Mismo patrón que el cono de visión de más arriba: **el bakeador solo deja el dato** — cada ventana lleva un `aporteLuz` numérico ya resuelto (`interiores/catalogo/ventanas.json` + `GDD_Bakeador_Interiores.md` sección 7bis) — y el cálculo real de "cuánta luz hay en esta sala ahora mismo" es del servidor en vivo, igual que el clima o las sombras en exteriores.

**HECHO (2026-08-30), 100% cliente, ver `client/src/render3d/luzInteriores.ts` y `docs/GDD_Sistema_Puertas.md`** — las piezas que quedaban por decidir, ya resueltas:

- **Curva día/noche**: `nivelLuzExterior(hora)` interpola LUNA(0.15)→1.0→LUNA entre `horaAmanecer`/`horaAnochecer` (`assets/mundo/tiempo.json`) con `Math.sin` — mismo estilo que `cicloDia.ts`/`clima.ts`. El suelo de luna quedó en 0.15, nunca 0.
- **Combinación**: `luzAmbienteSala(hora, sumaAporteLuz) = nivelLuzExterior(hora) × √sumaAporteLuz`, acotado a 1 — **raíz cuadrada, con rendimientos decrecientes** (decidido: no lineal): 4 ventanas de aporte 1 dan √4=2×, no 4×, frente a 1 ventana que da 1×.
- **Mezcla con luces interiores**: decidido que sea el MÁXIMO, pero implementado como SUMA por simplicidad de esta primera pasada (las antorchas siguen "siempre encendidas" a su intensidad fija, sin tocar) — con la intensidad de antorcha modesta no se nota sobre-iluminado en la práctica, pero sigue pendiente ajustar a la fórmula exacta si hiciera falta.
- **Sin orientación del edificio** — decisión ya tomada en `GDD_Bakeador_Interiores.md` sección 10 (nada de orientación solar): el cálculo no distingue a qué lado del mapa mira la ventana, solo su tamaño/tipo vía `aporteLuz`. Se mantiene: `luzAmbienteSala` no recibe ningún dato de orientación.

Prerrequisito que este cambio también resolvió (no estaba ni apuntado en el backlog porque no se sabía que faltaba hasta investigar para implementar esto): **ninguna ventana se instanciaba nunca** — `ventanas.json` era combinatoria de catálogo sin consumidor real. Ahora `colocarSala()` (`interiores/src/colocarElementos.js`) las coloca de verdad en el muro norte de cada sala (ver `GDD_Bakeador_Interiores.md` §7bis).

## Menú de construcción/decoración de interiores — concepto decidido, interfaz sin diseñar

Al preparar las reglas de colocación del bakeador de interiores (`GDD_Bakeador_Interiores.md` sección 7ter) salió la necesidad de dejar el terreno listo para que, más adelante, el jugador pueda amueblar/redecorar su propia vivienda desde un menú de construcción en vivo. Ya está decidido cómo se apoya en datos del bakeador para que sea coherente por diseño en vez de tener que reinventar reglas de colisión en el cliente:

- Un edificio se puede generar `amueblado: "vacio"` (solo estructura) o `"fijo"` (estructura + decoración fija, sin mobiliario movible) — los huecos que faltan por rellenar son exactamente las posiciones legales según la tabla de reglas de colocación (pared/suelo/techo, bloqueo de movimiento/visión, requisito de superficie anfitriona) que ya usa el propio motor de generación para no colocar nada ilegal.
- Los props colocables por el jugador son las mismas entradas de `elementos.json` con `capa: decorMovible` que ya coloca el bakeador en modo `"completo"` — mismo catálogo, misma `huella`, mismos `materialesCompatibles`, mismo `riquezaMinima` (¿puede un jugador humilde comprar un trono?, pendiente de decidir junto con la economía).
- `esSuperficie: true` en mesas/mostradores/atriles/altares marca qué elementos pueden alojar encima algo con `colocacion: sobreSuperficie` (una vela sobre una mesa) — dato ya en el catálogo, pendiente de que el cliente lo use para validar en vivo.

**Pendiente de definir cuando toque**: la interfaz en sí (arrastrar/soltar, rotar, previsualizar), si mover/quitar un mueble ya colocado por el bakeador está permitido o solo llenar huecos vacíos, cómo se adquieren los props (comprados, crafteados — conecta con "Oficios de crafteo" y "Comercio y economía" más abajo), y si hay coste/tiempo asociado a cada colocación.

- **Objetos sueltos de superficie, estilo Project Zomboid** (`plato`, `libro`, `frasco_pocion`, `moneda_suelta`... en `elementos.json`, `colocacion: sobreSuperficie`, capa `decorMovible` igual que el mobiliario grande): el bakeador los coloca como clutter ambiental sobre mesas/mostradores/atriles/altares (cualquier elemento con `esSuperficie: true`). Coger uno de estos en vivo debería quitarlo del mundo y convertirlo en objeto de inventario (desaparece de la sala, aparece en el inventario del jugador) — misma mecánica de "recoger" que el resto del juego, no algo exclusivo de interiores. Pendiente de definir junto con el sistema de inventario en general.

## Verbos de interacción a cubrir más adelante (recordatorio) — la mayoría de plantas/animales YA cubiertos

- **Plantas**: ~~cosechar~~ HECHO (Agricultura), ~~injertar~~ HECHO (Injertos). Sin cubrir: regar (hoy es automático/pasivo, no un verbo del jugador), enfermar, curar, transplantar, morir.
- **Animales**: ~~matar~~ HECHO (Caza/Combate), ~~domesticar~~ HECHO (Ganadería), ~~pelar/desollar~~ HECHO (`docs/GDD_Caza.md`, curtido), ~~cocinar~~ HECHO (`docs/GDD_Cocina.md`). Sin cubrir: secar, quemar, criar (cría de descendencia doméstica — confirmado pendiente, ver "Ciclo de vida y reproducción animal" arriba).
- **Insectos/fauna menor**: capturar (decoración, comida, cebo de pesca, u otros usos) — sin cubrir.

Todo esto refuerza la regla ya fijada de "todo lo que existe tiene un uso" — se van completando los usos concretos según se construya cada mecánica, no hace falta cerrarlos todos ahora.

## Ecología de ratas y gatos — concepto decidido, mecánica sin diseñar

Pedido del streamer 2026-08-28, explícitamente aparcado ("esto ahondaremos
más adelante") al implementar la fauna doméstica urbana v1.3
(`docs/GDD_Agentes_Moviles.md`, que sí trae gallinas/vaca/perros/gatos con
merodeo simple, sin esta parte).

- Las ratas comen basura/plantitas que se spawneen por el asentamiento —
  su propio spawn/consumo, aparte de la fauna doméstica.
- Si hay gatos sueltos, cazan ratas: la población de gatos REGULA la de
  ratas de forma natural (más gatos → menos ratas).
- Sin gatos (se los ha llevado un jugador, o han muerto), las ratas se
  reproducen sin control → plaga: entran en casas, roban comida de los
  inventarios de los jugadores.
- Implica: un sistema de población viva con reproducción/depredación (algo
  más que el merodeo de la fauna doméstica actual, que no tiene ciclo de
  vida ni interacción entre especies), spawn de basura/comida como recurso
  consumible, y el gato ganando una función real más allá de decoración
  (hoy es puro ambiente, ver GDD_Agentes_Moviles.md "Qué falta").

**Nota (2026-08-30)**: `docs/GDD_Twitch.md` §3 añade una "Plaga de ratas" como evento de puntos de canal (spawn temporal, sin reproducción ni depredación real, desaparecen solas a los 2 minutos) — es solo un evento de color por ahora, no la ecología real pedida aquí, que sigue exactamente igual de aparcada.
