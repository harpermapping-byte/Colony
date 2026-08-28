# GDD — Bakeador de Dungeons/Mazmorras (Verificado)

Fase de diseño acordada con el streamer (§7 de la versión anterior de este documento, conservada más abajo) y luego implementada entera. Este documento ya no es propuesta: describe lo construido, cómo se verificó y qué queda pendiente.

Respuestas del streamer a las preguntas abiertas (§7 original):
1. **Alcance**: "Más tipos ya en esta tanda" → se cargaron los **30 tipos** del catálogo, no solo los 3 de prueba.
2. **Tier de asentamiento hostil**: "Estética propia (muralla tosca, sin plaza de mercado...)" → nuevo tier `asentamiento_hostil` en `ciudades/catalogo/asentamientos.json` (empalizada tosca e irregular, sin plaza de mercado real).
3. **Instancia**: "Compartida (recomendado, consistente)" → mismo `filterBy` que el resto del proyecto (Hub/región/interior).

## 0. Investigación previa (algoritmos de dungeon)

- **BSP**: parte un rectángulo grande en dos mitades recursivamente hasta llegar a salas — layouts "de edificio", salas rectangulares. Encaja con ruinas/castillos/mazmorras estructuradas.
- **Autómata celular**: siembra ~40-55% de paredes al azar y aplica unas pocas iteraciones de la regla "una casilla se vuelve pared si 5+ de sus 8 vecinas lo son" — cavernas orgánicas sin ángulos rectos. Encaja con cuevas/madrigueras.
- **Spawns/loot en roguelikes**: pool de enemigos válidos por zona/piso + loot en contenedores, sala de jefe con el loot bueno.

Fuentes: [Procedural Dungeon Generation: Cellular Automata](https://blog.jrheard.com/procedural-dungeon-generation-cellular-automata), [2D Procedural Level Generation](https://jaconir.online/blogs/procedural-level-generation-guide), [Dungeon Generation Algorithms: Patterns and Tradeoffs](https://pulsegeek.com/articles/dungeon-generation-algorithms-patterns-and-tradeoffs/), [How Procedural Dungeons Work in Roguelikes](https://dinogame.gg/blog/how-procedural-dungeons-work/), [Loot table - Minecraft Wiki](https://minecraft.fandom.com/wiki/Loot_table), [Roguelike Dungeons - GT New Horizons](https://wiki.gtnewhorizons.com/wiki/Roguelike_Dungeons).

En vez de un algoritmo de layout de habitación por tipo, se usó **room-scatter + MST (Prim's)** para conectar las salas de una planta (más flexible que BSP puro para salas de tamaño muy variable colocadas por rejection-sampling) y **autómata celular acotado a la sala** (no al edificio entero) para la forma orgánica — mismo contrato de salida (máscara de casillas) tanto si la sala es rectangular como orgánica, así el resto del pipeline (mobiliario, conectores, colisión, render) no distingue.

## 1. Dónde encaja en la cadena de bakeadores

`baker/catalogo/pois.json` tiene la categoría `"mazmorra"` con un campo `dungeonTipoId` (uno de los 30 tipos de `mazmorras/catalogo/tipos_dungeon.json`). `baker/src/instanciasPOI.js` la reconoce y, según el `estiloExterior` del tipo, delega:

- `estiloExterior: "asentamiento"` → `ciudades/hornearCiudad` con el tier `asentamiento_hostil` (o el tier que indique `tierAsentamiento`). Mismo motor de ciudad, murallas toscas, sin plaza de mercado real.
- `estiloExterior: "edificio"` → caja 3D con la huella de `tipoEdificioIdExterior` + puerta, pero el interior lo genera `mazmorras/generarMazmorra.js` (salas grandes, rectangulares) en vez de `interiores/generarEdificio`.
- `estiloExterior: "cueva"` → sin caja 3D (boca de cueva, no es una caja rectangular) + puerta, mismo generador de mazmorra pero con salas orgánicas (autómata celular).

En los tres casos el portal lleva `esMazmorra: true` para que cliente/servidor abran `DungeonRoom` en vez de `InteriorRoom`.

## 2. Catálogo de tipos de dungeon — 30 tipos, 6 familias

`mazmorras/catalogo/tipos_dungeon.json`. Cada entrada: `{familia, estiloExterior, tipoEdificioIdExterior?, tierAsentamiento?, formaSala, riquezaLoot, temasEnemigo, bossPool, rangoPlantas, rangoSalasPorPlanta, salasPermitidas? (solo rectangular), colorDebug}`.

| Familia | `formaSala` | `estiloExterior` | Tipos |
|---|---|---|---|
| **Cueva** | orgánica | `cueva` | cueva_goblins, cueva_aranas, cueva_murcielagos, cueva_trasgos, cueva_cristal (legendaria) |
| **Ruinas** | rectangular, decadente | `edificio` | ruinas_templo_olvidado, ruinas_torre_caida, ruinas_biblioteca_arcana, ruinas_anfiteatro, ruinas_necropolis |
| **Fortaleza** | rectangular, noble | `edificio` | castillo_usurpado, fortaleza_orca, bastion_no_muerto, ciudadela_caida, torre_nigromante |
| **Asentamiento hostil** | (usa ciudades/) | `asentamiento` | aldea_bandidos, poblado_orco, guarida_piratas, asentamiento_cultistas, campamento_barbaros_grande |
| **Subterráneo** | mixta/rectangular | `edificio` | mina_abandonada, mina_maldita, catacumbas, mazmorra_real, cripta_ancestral |
| **Naturaleza infestada** | orgánica | `cueva`/`edificio` | guarida_lobos, nido_aranas_gigante, pantano_maldito, arboleda_corrupta, colmena_insectos |

`baker/catalogo/pois.json` tiene cada uno de los 30 con al menos una entrada de POI (algunos migrados de tipos "edificio"/"decorativo" previos — p.ej. `mazmorra_olvidada`→`ruinas_torre_caida`, `guarida_bandidos`→`aldea_bandidos` — el resto son entradas `_cualquiera` nuevas). Verificado por script: 30/30 tipos con ≥1 POI, cero referencias colgantes.

## 3. Generador de interior de mazmorra (`mazmorras/`, hermano de `interiores/`)

Reutiliza el motor de `interiores/`: mismo PRNG (`azar.js`), mismo concepto de `Sala`/`colocarElementos.js` para el caso rectangular, misma composición planta→edificio (`puertasConexion`, `conectoresVerticales` con escaleras=TP — reutilizado tal cual de `edificio.js`/`InteriorRoom.ts`). Lo que es nuevo:

- **Salas de mazmorra muy grandes**: 5 tipos nuevos en `interiores/catalogo/tipos_sala.json` (`camara_tesoro`, `calabozo`, `camara_ritual_oscura`, `salon_trono_ruinoso` hasta 20×24, `guarida_bestia` — este último es el tipo fijo usado para TODAS las salas de forma orgánica).
- **Forma orgánica** (`mazmorras/src/celular.js`): `generarFormaOrganica({ancho, alto, semilla})` — autómata celular (Moore-8, borde siempre pared, flood-fill se queda solo con la región más grande, recorte a bounding box) → `{ancho, largo, mascara}`. La `mascara` es un campo NUEVO y opcional del resultado de sala (`resultado.mascara`); su ausencia = comportamiento rectangular de siempre, 100% retrocompatible.
- **Layout de planta** (`mazmorras/src/generarMazmorra.js`): room-scatter por rejection-sampling + conexión por MST (Prim's) con pasillos en L (`carvarCorredor`), muchas más salas por planta que un edificio normal (`rangoSalasPorPlanta` del tipo).
- **Mobiliario de saqueo**: ~20 elementos nuevos en `interiores/catalogo/elementos.json` con `lootTier` (`cofre_madera`, `cofre_reforzado`, `arcon_tesoro`, `cofre_jefe`, `armeria_oxidada`...) más decoración temática (`altar_oscuro`, `trono_roto`, `jaula_prisionero`, `telarana_gigante`, `esqueleto_suelto`...).
- **Spawns de enemigos**: `spawnsEnemigos` por planta — muchos puntos candidatos bake-time (posición + `temasEnemigo` válidos ahí + `esBossSlot`), sin instanciar nada todavía.

## 4. Enemigos

### 4.1 Catálogo (`personajes/catalogo/enemigos.json`, hermano de `npcs.json`)

Reutiliza el generador de personajes al completo — cero motor de vóxeles nuevo: humanoides vía `generarPersonaje` (rig `npc`), bestias vía `generarAnimal` (`animal`), unificados por el wrapper `personajes/src/generarEnemigo.js`. 32 entradas: goblin(4), arana(2, reusa `arana_gigante` como animal nuevo en `baker/catalogo/animales.json` + rig en `animales_rig.json`), murcielago(2, rig `ave` nuevo), trasgo(3), no_muerto(4), bandido(4), orco(4), cultista(4), pirata(3), lobo(2, reusa el animal `lobo` existente). 3 tonos de piel nuevos con peso 0 en `personajes/catalogo/rasgos.json` (`hueso`/`ceniciento`/`piedra` — para no-muertos/espectros, nunca salen en aldeanos random).

### 4.2 Pool de apariencia pre-bakeado (regla "generar una vez")

`personajes/src/exportar_enemigos.js` genera offline `assets/enemigos/pool.json` — N variantes ya renderizadas por enemigo (vóxeles resueltos). El servidor en vivo (`DungeonRoom`) SOLO elige `(enemigoId, variante)` en runtime, nunca genera geometría.

### 4.3 Spawns: bake-time coloca puntos, runtime decide población

- **Bake-time**: cada sala reparte varios `spawnsEnemigos` deterministas por semilla (~150-250 en total en una dungeon grande).
- **Runtime** (`server/src/rooms/DungeonRoom.ts`, hermana de `InteriorRoom` — `InteriorRoom` cambió sus campos `interior`/`opciones` de `private` a `protected` para esto): al crearse la room (Colyseus `filterBy: ["mapaId","edificio","nivel"]`, misma instancia compartida para todos), se baraja (Fisher-Yates) y recorta el pool de candidatos a un tope por tipo (30 normales + 2 jefes) y se puebla `HubState.enemigos` (nuevo `MapSchema<Enemigo>`, mismo patrón que el `Npc`/`GestorAgentes` que ya usan las regiones vivas). Elección de qué enemigo concreto por punto: `elegirEnemigoDeTema()`, ponderado por `pesoSpawn`, filtrando por `esBoss` en los slots de jefe.
- **Cooldown de 1h**: `server/src/datos/bd.ts` gana `obtenerLimpiezaMazmorra`/`marcarMazmorraLimpiada` + tabla `mazmorras_estado` (SQLite dev / Postgres prod, mismo patrón dual que construcción). El TRIGGER de "marcar limpiada" queda sin conectar todavía — depende del sistema de combate, que el streamer dijo explícitamente que se explica aparte.

## 5. Loot — sigue siendo placeholder

Sin sistema de ítems/inventario en el proyecto. Los contenedores llevan `lootTier` (`humilde`/`modesta`/`rica`/`jefe`) sin resolver a ítems reales — la máquina que decide el tier ya está lista, conectarla a ítems de verdad es pieza aparte.

## 6. Verificación

- `mazmorras/test/mazmorra.test.js` (5/5): forma orgánica siempre 1 región conexa; los 30 tipos generan sin error en 2 semillas; determinismo byte a byte; `temasEnemigo`/`bossPool` de cada tipo referencian enemigos reales del catálogo; **regresión del bug de jefe** (ver abajo) reproduciendo el filtro exacto de `DungeonRoom.ts` contra mazmorras reales generadas.
- `server/test/mazmorra.test.ts` (3/3): flood-fill de conectividad real contra la rejilla de colisión que carga el servidor (7 tipos × 3 semillas, todas las salas alcanzables); `spawnsEnemigos` expuestos y sin solape con muebles; escaleras=TP con nivel-destino correcto en dungeon multi-planta.
- Suite completa del proyecto en verde tras el cambio: server 46/46, mazmorras 5/5, interiores 32/32, ciudades 8/8, poblacion 4 archivos, `tsc` limpio en server y client.
- Verificación visual (`client/test/prueba_render_mazmorra.cjs`, Playwright, no forma parte de la suite automática): bake real de una dungeon `cueva_aranas` y una `torre_nigromante`, entra por el portal, confirma `window.__enemigos().total > 0` en ambas y guarda capturas.

### Bug encontrado y corregido: el jefe nunca aparecía

El slot de jefe guardaba `temasEnemigo: def.bossPool` (una lista de IDs de enemigo, p.ej. `["reina_arana"]`) en vez de `def.temasEnemigo` (temas, p.ej. `["arana"]`). `DungeonRoom.elegirEnemigoDeTema()` filtra por TEMA, así que nunca encontraba nada — el jefe se perdía en silencio (sin error, solo un spawn de menos). Encontrado con la sonda `__enemigos()` de la prueba visual (`bosses:0` tras activar dos dungeons). Corregido en `generarMazmorra.js` (una línea) y blindado con un test de regresión nuevo que reproduce el mismo filtro que usa `DungeonRoom.ts` contra mazmorras reales de los 30 tipos.

## 7. Qué falta (pendiente real, no placeholder de arte)

- **Enemigos en casas de asentamiento hostil**: el exterior/estructura de `estiloExterior:"asentamiento"` funciona (muralla tosca, sin mercado), pero cada casa usa `interiores/generarEdificio` normal, que no tiene concepto de `spawnsEnemigos` — hoy esas casas están vacías por dentro. Falta decidir si se les añade el mismo mecanismo de mazmorra o uno más ligero.
- **Trigger de "mazmorra limpiada"**: la persistencia del cooldown (`mazmorras_estado`) está lista pero nada llama a `marcarMazmorraLimpiada` todavía — depende del sistema de combate (fuera de alcance de este documento).
- **Arte 3D real de dungeon**: la caja exterior de las de `estiloExterior:"edificio"` reusa la huella genérica de `tipoEdificioIdExterior` (mismo placeholder que el resto del proyecto) — sin modelo `.glb` específico de dungeon todavía. `estiloExterior:"cueva"` ya no se queda sin ningún rastro exterior: `baker/src/instanciasPOI.js` (`generarBocaCueva`) reparte un arco de rocas del propio bioma (`baker/catalogo/rocas.json`) alrededor del portal, con el hueco de la puerta despejado — mismo espíritu placeholder que el resto (rocas ya existentes, cero arte nuevo), pero ya no es un claro de hierba vacío.
- **Ítems/loot real** (§5): `lootTier` sin resolver a inventario.
- **Iluminación de interiores/mazmorras**: arreglado — `client/src/render3d/interiorVisual.ts` ahora enciende un `THREE.PointLight` por cada pieza `capa:"iluminacion"` colocada (antorchas/candelabros), siempre encendidas (no dependen de la hora exterior, GDD_Bakeador_Interiores §"Luces interiores"). También se cerró un hueco real: `mazmorras/src/generarMazmorra.js` (`colocarMobiliarioOrganico`, salas orgánicas de cueva) no copiaba el campo `capa` al colocar mobiliario, así que ninguna sala orgánica podía tener luz aunque el catálogo la ofreciera; y 10 tipos de sala de `interiores/catalogo/tipos_sala.json` (incluido `guarida_bestia`, el tipo fijo de TODAS las salas orgánicas de mazmorra, y `camara_tesoro`) no tenían NINGÚN elemento de iluminación válido en su `tiposSalaValidos` — ampliado en `elementos.json` para que los 44 tipos de sala tengan al menos una opción. Sigue siendo probabilístico por riqueza (una sala humilde puede seguir sin luz, a propósito — GDD_Bakeador_Interiores).
- **Combate y XP/recompensas**: explícitamente fuera de alcance, lo explica el streamer aparte.
