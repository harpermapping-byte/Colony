# GDD — Bakeador de Dungeons/Mazmorras (PROPUESTA, sin programar todavía)

Este documento es la fase de "afinar antes de programar" que pidió el streamer. Es una PROPUESTA para revisar y acordar — nada de esto está implementado. Cuando se apruebe (entero o con cambios), se pasa a construir y este documento se actualiza como el resto de GDD ("Verificado"/"Qué falta").

## 0. Investigación previa (algoritmos de dungeon, para que el diseño tenga base)

- **BSP (Binary Space Partitioning)**: parte un rectángulo grande en dos mitades recursivamente hasta que los trozos son del tamaño de una sala; luego conecta cada par de sub-particiones con un pasillo. Da layouts "de edificio": salas rectangulares, pasillos rectos — encaja con ruinas/castillos/mazmorras estructuradas.
- **Autómata celular (cellular automata)**: siembra el mapa con ~40-55% de paredes al azar y aplica unas pocas iteraciones de una regla local ("una casilla se vuelve pared si 5+ de sus 8 vecinas lo son"); el resultado son cavernas orgánicas, sin ángulos rectos — encaja con cuevas/madrigueras.
- **Enfoque híbrido** (el que usa la mayoría de roguelikes modernos): BSP para las salas "de construcción" y autómata celular para los tramos de cueva, dentro del MISMO dungeon si hace falta (p.ej. una mina: túneles orgánicos que desembocan en una cámara de piedra tallada).
- **Spawns/loot en roguelikes**: la mayoría de salas están vacías o son solo de paso; las que tienen contenido llevan un "spawner" (pool de enemigos válidos para esa zona/piso, con dificultad creciente) + loot en contenedores, y las salas de jefe noueltan el loot bueno hasta que el jefe cae.

Fuentes consultadas: [Procedural Dungeon Generation: Cellular Automata](https://blog.jrheard.com/procedural-dungeon-generation-cellular-automata), [2D Procedural Level Generation: BSP, Cellular Automata & Interactive Prototyper](https://jaconir.online/blogs/procedural-level-generation-guide), [Dungeon Generation Algorithms: Patterns and Tradeoffs](https://pulsegeek.com/articles/dungeon-generation-algorithms-patterns-and-tradeoffs/), [How Procedural Dungeons Work in Roguelikes](https://dinogame.gg/blog/how-procedural-dungeons-work/), [Loot table - Minecraft Wiki](https://minecraft.fandom.com/wiki/Loot_table), [Roguelike Dungeons - GT New Horizons](https://wiki.gtnewhorizons.com/wiki/Roguelike_Dungeons).

Esto confirma la intuición del streamer: no hace falta un algoritmo nuevo por tipo de dungeon, con DOS motores de sala (rectangular "de construcción" y orgánico "de cueva") + una capa de spawns/loot encima llega para las 6 familias que se proponen abajo.

## 1. Dónde encaja en la cadena de bakeadores

Mismo patrón que ya existe para POIs (`docs/GDD_Bakeador_POIs.md` §7): `baker/catalogo/pois.json` gana una `categoria` más, `"mazmorra"`, con un campo `dungeonTipoId` (uno de los ~30 tipos del catálogo nuevo `mazmorras/catalogo/tipos_dungeon.json`). `baker/src/instanciasPOI.js` la reconoce y, según el `estiloExterior` de ese tipo (ver §2), delega en UNO de los dos generadores que ya existen — sin generador nuevo para el exterior:

- `estiloExterior: "asentamiento"` → exactamente el mismo camino que un POI "asentamiento" de verdad (`ciudades/hornearCiudad`), pero con un **tier hostil** nuevo en `ciudades/catalogo/asentamientos.json` (mismo motor, reskin de facción: NPCs → enemigos, sin campesinos/comercio). Es la aldea/poblado enemigo.
- `estiloExterior: "edificio"` → exactamente el mismo camino que un POI "edificio" de verdad (`interiores/generarEdificio` + caja 3D + puerta), pero el `tipoEdificioId` apunta a un tipo de edificio NUEVO y grande (ver §3) en vez de una casa normal, y el interior que genera no es un `interiores/` normal — es el generador de MAZMORRA nuevo (§3), enganchado exactamente donde hoy `interiores/generarEdificio` genera el interior de un edificio (mismo contrato de entrada/salida: un JSON de plantas+salas+conectoresVerticales que ya sabe cargar `server/mundo/interiorColision.ts`).
- `estiloExterior: "cueva"` → una boca de cueva (prop simple sobre el terreno, sin "solar_edificio" — una cueva no es una caja rectangular) + puerta, mismo generador de mazmorra (§3) pero con el motor de SALA orgánica en vez de rectangular.

Con esto, "bakea mundo → bakea todo encadenado" (la petición explícita de la sesión anterior) sigue funcionando sin tocar el orquestador: solo se añade una categoría más al `switch` de `instanciasPOI.js`.

## 2. Catálogo de tipos de dungeon — 6 familias × 5 = 30

Nuevo catálogo `mazmorras/catalogo/tipos_dungeon.json`. Cada entrada:

```json
"cueva_goblins": {
  "familia": "cueva",
  "estiloExterior": "cueva",
  "formaSala": "organica",
  "riquezaLoot": "humilde",
  "temasEnemigo": ["goblin", "cueva"],
  "bossPool": ["jefe_goblin_grande"],
  "rangoPlantas": [2, 4],
  "rangoSalasPorPlanta": [6, 12],
  "colorDebug": "#5a4a3a"
}
```

| Familia | `formaSala` | `estiloExterior` | 5 tipos (arranque de prueba: **3 primeros implementados**, resto documentados para cuando se amplíe el catálogo) |
|---|---|---|---|
| **Cueva** | orgánica | `cueva` | cueva_goblins★, cueva_aranas★, cueva_murcielagos, cueva_trasgos, cueva_cristal (legendaria) |
| **Ruinas** | rectangular, decadente (huecos/columnas caídas) | `edificio` | ruinas_templo_olvidado★, ruinas_torre_caida, ruinas_biblioteca_arcana, ruinas_anfiteatro, ruinas_necropolis |
| **Fortaleza** | rectangular, noble | `edificio` | castillo_usurpado★, fortaleza_orca, bastion_no_muerto, ciudadela_caida, torre_nigromante |
| **Asentamiento hostil** | (usa ciudades/, N/A) | `asentamiento` | aldea_bandidos★, poblado_orco, guarida_piratas, asentamiento_cultistas, campamento_barbaros_grande (migra desde POI "edificio" suelto a esta familia — más coherente como aldea completa) |
| **Subterráneo** | mixta (túneles orgánicos + cámaras talladas) | `edificio` | mina_abandonada (recategoriza el POI "decorativo" ya existente), mina_maldita, catacumbas, mazmorra_real, cripta_ancestral |
| **Naturaleza infestada** | orgánica | `cueva`/`edificio` según tipo | guarida_lobos, nido_aranas_gigante, pantano_maldito, arboleda_corrupta, colmena_insectos |

★ = de los que se construirían primero como prueba (uno rectangular, uno orgánico, uno de asentamiento — cubre los 3 caminos de generación distintos), siguiendo el MISMO patrón que ya usan `personajes/catalogo/npcs.json` y `animales_rig.json` ("arranque de prueba, la lista definitiva la amplía el streamer y se regenera todo del tirón" — CLAUDE.md regla 7, "las listas crecen, el código no").

## 3. Generador de interior de mazmorra (`mazmorras/` — nuevo módulo, hermano de `interiores/`)

Reutiliza el motor de `interiores/` en vez de duplicarlo: mismo PRNG (`azar.js`), mismo concepto de `Sala`/`colocarElementos.js`, misma composición planta→edificio de `edificio.js` (salas colocadas, `puertasConexion`, `conectoresVerticales` con posición real — el trabajo de "escaleras=TP" de esta sesión se reutiliza TAL CUAL para subir/bajar plantas de una mazmorra grande). Lo que cambia:

- **Salas MUY grandes** (`interiores/` genera salas de casa, aquí hacen falta cámaras de 15×15 a 25×20 — nuevos rangos de tamaño en el catálogo de tipos de sala de mazmorra, no en el de interiores normales, para no inflar las casas).
- **Forma de sala** (`formaSala: "organica"`): en vez de `colocarElementos.js` (rectángulo), un motor nuevo con autómata celular acotado al rectángulo de la sala (según la investigación de §0) — mismo contrato de salida (una máscara de casillas suelo/pared) para que TODO lo demás (colocación de muebles, conectores, render) no tenga que saber la diferencia.
- **Muchas más salas por planta y muchas más plantas** que un edificio normal (`rangoSalasPorPlanta`/`rangoPlantas` del tipo de dungeon), todas conectadas — el objetivo declarado es "recorrer, matar enemigos, muchas salas, pisos arriba y abajo".
- **Mobiliario de mazmorra**: salas MUY amuebladas (pedido explícito, "sin límite") — hace falta añadir a `interiores/catalogo/elementos.json` (o un catálogo hermano `mazmorras/catalogo/elementos_mazmorra.json`, a decidir) piezas de saqueo por tema: `cofre_madera`, `cofre_reforzado`, `cofre_jefe`, `urna_funeraria`, `barril_provisiones`, `estanteria_alquimia`, `arcon_tesoro`, `jaula_prisionero`, `altar_oscuro`, `pila_huesos`, `telarana_gigante`, `nido_arañas`, etc. — cada pieza de saqueo lleva `lootTier` (ver §5) en vez de (o además de) `colorDebug` normal.
- **Puntos de spawn de enemigos** (`§4`): un array `spawnsEnemigos` por planta, NO instancias reales — coordenada + `temasEnemigo` válidos ahí + `esBossSlot`. Bake-time coloca MUCHOS puntos candidatos (pedido: "imagina 200"); runtime decide cuáles se usan.

## 4. Enemigos — catálogo + spawns

### 4.1 Catálogo de enemigos (`personajes/catalogo/enemigos.json`, hermano de `npcs.json`)

Reutiliza el generador de personajes AL COMPLETO (mismo rig humanoide de `rigHumanoide.ts`/`generarPersonaje.js` para enemigos humanoides — goblins, bandidos, orcos, cultistas, no-muertos; mismos 3 esqueletos de `generarAnimal.js` — cuadrúpedo para lobos/arañas grandes, ave para murciélagos, insecto para arañas/enjambres). Cero motor nuevo de vóxeles: un enemigo ES un NPC/animal con otra ficha.

```json
"goblin_guerrero": {
  "esqueleto": "npc",
  "temasEnemigo": ["goblin", "cueva"],
  "morfologia": { "altura": [0.7, 0.85], "corpulencia": [0.85, 1.0] },
  "colorDebug": "#5a7a3a",
  "esBoss": false,
  "pesoSpawn": 10,
  "lootTier": "humilde"
},
"jefe_goblin_grande": {
  "esqueleto": "npc",
  "temasEnemigo": ["goblin"],
  "morfologia": { "altura": [1.15, 1.3], "corpulencia": [1.3, 1.5] },
  "colorDebug": "#3a5a1a",
  "esBoss": true,
  "lootTier": "jefe"
}
```

Arranque de prueba (mismo criterio de §2): ~10-12 enemigos base + 3 jefes, cubriendo las familias de los 3 tipos de dungeon de prueba (goblins/arañas para cueva, esqueletos/espectros para ruinas, bandidos/capitán para el asentamiento hostil) — variedad real ("que no sea repetitivo, algunos comparten, otros son únicos") sale de que `temasEnemigo` se puede compartir entre varios `dungeonTipoId` (un lobo puede salir tanto en `guarida_lobos` como en `cueva_goblins` si comparte tema) mientras que un jefe normalmente lleva un tema único.

### 4.2 Spawns: bake-time coloca puntos, runtime decide población

- **Bake-time** (`mazmorras/`, offline): cada sala válida para combate reparte varios `spawnsEnemigos` (posición + qué `temasEnemigo` acepta ahí + si es slot de jefe) — determinista por semilla, como todo lo demás. Una dungeon grande puede acumular ~150-250 puntos en total entre todas sus salas/plantas.
- **Runtime** (servidor, NUEVO — `DungeonRoom`, hermana de `InteriorRoom`): al ACTIVARSE la instancia (primer jugador que entra), se sortea con la semilla de la sesión un subconjunto acotado de esos puntos — techo configurable por tipo de dungeon (p.ej. 30 enemigos normales + 2 jefes) — y ahí es donde de verdad aparecen los personajes generados vía `personajes/generarPersonaje.js` con un `temaEnemigo` compatible con ese punto. Cada visita a una dungeon YA LIMPIA vuelve a elegir OTRO subconjunto distinto de los mismos 200 puntos (mismo catálogo de sitios, población distinta cada vez — pedido explícito: "para que cada vez que se entre no spawneen enemigos en las mismas zonas").
- **Cooldown de 1h tras limpiarla**: estado por instancia de dungeon (`limpiadaEn: timestamp`), persistido igual que ya hace el sistema de construcción (`server/src/datos/`, SQLite) para sobrevivir un reinicio del proceso — mientras dure el cooldown, la dungeon se sirve "vacía" (0 enemigos activos, contenedores ya saqueados si se saquearon) en vez de repoblar.

## 5. Loot — placeholder, sin sistema de items todavía

No hay inventario/ítems en el proyecto hoy (ni falta hasta que se diseñe esa mecánica — el streamer ya avisó que XP/recompensas son un tema futuro que no se plantea ahora). Por eso el loot de esta fase es **puramente estructural**: cada contenedor de saqueo lleva un `lootTier` (`humilde`/`modesta`/`rica`/`jefe`, escalando con la riqueza del tipo de dungeon) sin resolver a ítems reales todavía — mismo espíritu que "todo el arte es placeholder": la MÁQUINA que decide "este cofre es de tier jefe, este armario es humilde" ya queda lista, conectarla a un sistema de ítems de verdad es una pieza aparte cuando exista.

## 6. Lo que este documento NO cubre (fuera de alcance, lo dijo el propio streamer)

- **Combate**: el streamer avisó que lo explicará aparte ("ya explicaré cómo es el combate que será también instanciado") — este documento solo coloca enemigos en el mundo, no decide cómo se pelea con ellos.
- **Sistema de experiencia/recompensas reales.**
- **Ítems/inventario real** (§5).

## 7. Preguntas abiertas — antes de programar

1. **Alcance de esta primera pasada**: ¿construir la MAQUINARIA completa (catálogo de tipos, generador rectangular+orgánico, catálogo de enemigos, DungeonRoom+spawns+cooldown) con los **3 tipos de prueba marcados con ★** (uno por camino: cueva orgánica, ruina rectangular, aldea hostil) — mismo patrón que interiores/personajes ("arranque de prueba, se amplía después") — o intentar dejar más tipos/enemigos ya cargados en esta misma tanda?
2. **Tier de asentamiento hostil**: para `estiloExterior: "asentamiento"` hace falta un tier nuevo en `ciudades/catalogo/asentamientos.json` con reskin de facción (murallas/decoración más agresivas, sin comercio) — ¿vale con reusar el tier `aldea`/`aldea_pequena` normal y solo cambiar qué "NPCs" pueblan las casas (enemigos en vez de aldeanos), o quieres una estética de asentamiento distinta desde la propia generación de la ciudad (murallas más toscas, sin plaza de mercado, etc.)?
3. **Cooldown/instancia compartida**: como el resto del proyecto (Hub/región/interior), ¿una dungeon es UNA instancia compartida por todos los jugadores (quien llega la ve como esté, limpia o en cooldown — como ya funciona todo lo demás vía `filterBy`), o ya para dungeons se plantea instancia por grupo/jugador? Asumo lo primero (consistente con todo lo demás) salvo que digas lo contrario.

Con el OK a esto (o a lo que cambies), se pasa a construir.
