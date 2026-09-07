# GDD — Crafteo: materiales por tier, refinamiento y recetas

**ESTADO: APLICADA (2026-08-29), verificada — AMPLIADA (2026-08-30) con fallback al suelo y desgaste de herramientas.** Arquitectura acordada en conversación con el streamer para el sistema de crafteo que `docs/GDD_Profesiones.md` dejó como "pendiente, oficio a oficio". Aquí se fija la FORMA del sistema (dos capas, catálogos, cómo persiste) y se implementa el MECANISMO completo con una receta representativa por familia — el árbol exhaustivo de recetas de cada uno de los 38 oficios sigue siendo trabajo posterior, oficio a oficio, con este contrato ya construido y probado. La ampliación del 30-08 nació de contrastar una propuesta externa genérica de "sistema de crafteo por capas" — casi todo lo que pedía ya estaba construido con nombre propio (ver §5); solo faltaban dos piezas reales, ambas aplicadas: entrega al suelo si no cabe, y desgaste de herramientas de gate. Verificado: `inventario.test.ts` +1 test (durabilidad de cuchillos), suite completa de servidor 675/675, `tsc --noEmit` limpio en server y client.

**Aplicado**: `insumos` real en `DatosProduccion` (`server/src/construccion/produccion.ts`) — el refinamiento consume stock de verdad, capado por el insumo más escaso, mismo cálculo perezoso de siempre; `server/src/construccion/crafteo.ts` (nivelDeXp, validarCrafteo, crafteoListo) — capa activa; 14 materiales refinados tier1/tier2 + `familiaMaterial`/`tier` en los 24 recursos crudos ya existentes (`items/catalogo/items.json`); 6 plantillas de refinamiento nuevas (fundicion, forja_aleaciones, cantera, planta_curtido, hilanderia, taller_lapidario) + retrofit de `aserradero` con insumo real (`interiores/catalogo/tipos_edificio.json`); `items/catalogo/recetas.json` con 7 recetas representativas (una por familia, varias transversales); protocolo Colyseus `refinamiento:depositar`/`crafteo:iniciar`/`crafteo:recolectar` (`RoomExteriorBase.ts`); tabla `jugador_oficios` (XP por oficio, nivel derivado en código puro, nunca persistido). Verificado: 21 tests puros nuevos (produccion.test.ts, crafteo.test.ts, datos.test.ts), 275/275 tests de servidor, `tsc` limpio, y E2E manual con servidor real + reinicio: fundición refina hierro→lingote_hierro con insumo real (sobrevive al reinicio), crafteo activo clavos_hierro completo (insumo descontado al iniciar, tiempo real, XP otorgada, ítem entregado), y casos negativos (mesa incorrecta, nivel insuficiente) — 12/12 comprobaciones OK.

## 0. Concepto (pedido literal del streamer, 2026-08-29)

Escalera de materiales POR FAMILIA (metal, madera, piedra, cuero, tela, precioso — cada una con su propia cadena, no un tier global): material base → refinado(s) → refinado(s) más avanzados, mezclando entre tiers y entre familias. Esos materiales alimentan recetas de CUALQUIER cosa (armas, armaduras, comida, muebles, herramientas, accesorios, y materiales de otros oficios). Una receta exige: plano desbloqueado + nivel de habilidad/oficio + mesa/zona correcta.

## 1. Dos capas, dos ritmos distintos

**Refinamiento (tier N → tier N+1): automatizado, "más Factorio"** — extiende `resolverProduccion` (docs/GDD_Produccion.md) con INSUMOS reales que se consumen (hoy la colmena/aserradero producen "de la nada"; el refinamiento consume stock de verdad). Cálculo perezoso, cero tick, igual que hoy: se resuelve al tocar la construcción. El trabajador (ya existe) activa la línea; la energía motriz (ya existe, `energia.consume`/`multiplicador`) acelera el ritmo — es EL caso de uso para el que Motriz se diseñó (fragua con martillo pilón mecanizado, refinando mineral→lingote más rápido que a mano). El transporte NPC (ya existe) mueve el output de una estación al insumo de la siguiente sin tocar nada de logística — mina→fragua→forja es una cadena de 3 construcciones con 2 contratos, con la maquinaria que ya existe.

**Crafteo del objeto final: activo, disparado por el jugador** — mesa correcta + plano desbloqueado + nivel de oficio suficiente, consume del INVENTARIO del jugador (no de un almacén automatizado), tarda un tiempo base multiplicado por `factorVelocidadPorEnergia` si la mesa está conectada a la red motriz (el gancho ya existe desde Motriz, sin usar todavía). Recetas TRANSVERSALES: una espada pide acero (herrero) + empuñadura de cuero curtido (curtidor) — al jugador solo le importa tener ambos en el inventario, no de qué oficio salió cada uno.

## 2. Familias y tiers — taxonomía de arranque

Cada familia es una escalera INDEPENDIENTE (el streamer confirmó: por familia, no global). Ejemplo completo con metal (el caso más claro, mina→fragua→forja) y esquema ligero para el resto — se rellena oficio a oficio cuando toque, mismo patrón:

| Familia | Tier 0 (crudo, ya en items.json) | Tier 1 (refinado, NUEVO) | Tier 2 (avanzado, NUEVO) |
|---|---|---|---|
| Metal | hierro, cobre, estano, oro, plata, platino, plomo | lingote_hierro, lingote_cobre, lingote_estano, lingote_oro, lingote_plata, lingote_platino, lingote_plomo | acero (lingote_hierro+carbon), bronce (lingote_cobre+lingote_estano) |
| Madera | madera_blanda, madera_abedul, madera_sauce, madera_palmera | **madera_dura ya existe y ya la produce el aserradero de Producción** — encaja sin tocar nada | madera_tratada (madera_dura+resina, NUEVO) |
| Piedra | piedra_comun, cuarzo | piedra_tallada, cristal_pulido (picapedrero/vidriero, ya dados de alta) | piedra_reforzada (piedra_tallada+metal) |
| Cuero/piel | cuero_grueso, cuero_reptil, piel_basta, piel_fina, piel_invierno, piel_exotica | cuero_curtido (curtidor, ya dado de alta) | cuero_endurecido (cuero_curtido+resina o metal) |
| Tela | fibra_vegetal | tela_hilada (sastre) | tela_reforzada |
| Precioso | gema | gema_tallada (joyero) | (entra directo en receta final, engarzada — no necesita tier 2 propio) |

**Comida NO sigue este patrón** — es ingrediente→plato, no una escalera de "dureza"; se craftea directo con el cocinero, fuera de esta taxonomía.

Nota real encontrada al mirar el catálogo: `madera_dura` YA es, sin que nadie lo llamara así, un tier 1 de la familia madera — el aserradero de Producción ya lo produce. Es la prueba de que el patrón encaja con lo que ya existe, no una invención nueva.

## 3. Catálogo — extensión de `items/catalogo/items.json` (aditivo)

```json
"lingote_hierro": {
  "peso": 1, "apilable": true, "stackMax": 20,
  "familiaMaterial": "metal",
  "tier": 1
}
```

`familiaMaterial` (string|null) y `tier` (entero, 0 = crudo) son campos NUEVOS opcionales — los ítems que ya existen sin ellos siguen funcionando exactamente igual (aditivo puro, mismo criterio que `energia`/`produccion` en construcción). El tier 0 de cada familia son los recursos crudos que YA tiene `categoriaRecurso` — solo hace falta añadirles `familiaMaterial`/`tier:0`, no crear nada.

## 4. Refinamiento — extensión de `DatosProduccion` (`server/src/construccion/produccion.ts`)

```ts
export interface InsumoProduccion {
  itemId: string;
  /** Consumido del almacén de la construcción por cada unidad de output producida. */
  cantidadPorUnidad: number;
}

export interface DatosProduccion {
  itemId: string;
  cantidadPorIntervalo: number;
  intervaloHoras: number;
  capacidadMax: number;
  requiereTrabajador?: boolean;
  /** NUEVO: si está presente, el refinamiento consume esto — sin insumos, se comporta EXACTAMENTE como hoy (colmena/aserradero, "de la nada"). */
  insumos?: InsumoProduccion[];
}
```

`resolverProduccion` necesita un dato más: el stock disponible de cada insumo en el almacén de la construcción (mismo `extra` que ya guarda el acumulador de output) — la producción se capa por el insumo más escaso, igual que `resolverTransporte` ya capa por stock/hueco. Sin insumos declarados, cero cambio de comportamiento (colmena/aserradero de Producción siguen igual). El almacén de insumos de una estación de refinamiento reutiliza el mismo mecanismo que un tenderete (`tenderete_items` — GDD_Mercado.md) para "cuánto stock tengo aquí", en vez de inventar una tercera forma de guardar cantidades.

## 5. Crafteo final — nuevo `items/catalogo/recetas.json` + protocolo `crafteo:*`

```json
"espada_hierro_basica": {
  "oficio": "herrero_armas",
  "mesas": ["yunque", "martillo_pilon"],
  "nivelMinimo": 2,
  "planoRequerido": "plano_espada_hierro_basica",
  "insumos": [
    {"itemId": "acero", "cantidad": 2},
    {"itemId": "cuero_curtido", "cantidad": 1}
  ],
  "resultado": {"itemId": "espada_hierro_basica", "cantidad": 1},
  "tiempoBaseSeg": 30
}
```

Flujo: jugador junto a una mesa con `temasProfesion` compatible → `crafteo:iniciar {recetaId}` → servidor valida (dueño del plano, nivel de oficio, insumos en el inventario, mesa correcta) → descuenta insumos → aplica `factorVelocidadPorEnergia` (ya existe, `server/src/construccion/energia.ts`) al `tiempoBaseSeg` → tras el tiempo, entrega el resultado al inventario (mismo mecanismo que "coger"). Mismo criterio de validación server-autoritativa que el resto del proyecto — el cliente solo sugiere.

**Entrega: al inventario, o al suelo si no cabe (ampliación 2026-08-30)**. Antes, si la mochila no tenía hueco/peso libre al recolectar, el crafteo daba error y el jugador se quedaba SIN el resultado (los insumos ya se habían descontado al iniciar) — el material se perdía sin más. `manejarCrafteoRecolectar` ahora usa `entregarOSoltar` (`RoomExteriorBase.ts`): si no cabe (hueco O peso), el resultado se materializa a los pies del jugador como `ObjetoMundoSchema`, mismo mecanismo que "soltar" manual — nunca se pierde. `crafteo:completado` manda `enSuelo:boolean` para que el cliente lo indique. Mismo fallback aplicado a `cocina:preparar`/ensalada/bocadillo (`docs/GDD_Cocina.md`).

**Herramientas "de gate" con desgaste real (ampliación 2026-08-30)**. `cuchillo_desollar` (desollar cadáver, raspar piel salada, `animal:sacrificar`) y `cuchillo_cocina` (cortar ensalada, cortar pan) solo se validaban por TENENCIA — nunca perdían durabilidad. Ahora ambas llevan `durabilidadMax:40, desgastePorUso:1` en `items.json` y cada uso llama a `registrarUso`/`estaRoto` (`server/src/inventario/desgaste.ts`, el MISMO sistema que ya desgastaba armas/armaduras — nada nuevo, solo enganchado) vía el helper `usarHerramientaDeGate`. Un cuchillo roto (0 durabilidad) bloquea la acción con error explícito — sin sistema de reparación todavía, hay que reemplazarlo. Aprovechado también para corregir una clave `cuchillo_desollar` DUPLICADA en `items.json` (JSON.parse se quedaba silenciosamente con la última, sin bug funcional pero sucio).

`edificioRequerido` (campo opcional añadido en `docs/GDD_Barcos.md`, pedido
2026-08-30): además de la mesa correcta, exige que exista una construcción
viva de ese id (`interiores/catalogo/tipos_edificio.json`) en el
asentamiento actual — comprobado en `manejarCrafteoIniciar`
(`RoomExteriorBase.ts`), NO en `validarCrafteo` (que se mantiene pura, sin
`ContextoConstruccion`). Sirve para atar una receta a un edificio especial
del jarl (p.ej. barcos ↔ `astillero`) sin que baste con tener la mesa suelta.

## 6. Nivel de oficio (XP) — tabla nueva en BD

El streamer confirmó las DOS cosas del punto 4 combinadas, no una u otra: XP por oficio (sube con el uso, como ya decía el Backlog) Y tier de material como gate — se unen así: el nivel de oficio (derivado de XP) es lo que DESBLOQUEA qué tier puedes tocar, tanto para operar una estación de refinamiento de tier alto (asignarte como trabajador) como para intentar una receta de tier alto.

```sql
CREATE TABLE IF NOT EXISTS jugador_oficios (
  jugador_id INTEGER NOT NULL,
  oficio TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (jugador_id, oficio)
);
```

Nivel = función pura de XP (tabla de umbrales, ej. nivel 1=0xp, 2=100xp, 3=300xp...) — no se persiste el nivel en sí, se deriva, mismo espíritu que "nunca dupliques una fuente de verdad". XP sube al completar un crafteo activo (§5) — el refinamiento pasivo (§4) NO da XP (es automatizado, no es "el jugador practicando el oficio").

**Investigado 2026-09-07 (pedido streamer: "revisar si cada nivel de mesa tiene blueprints adecuadas en cada oficio")**: auditando `recetas.json` se confirmó que NINGÚN oficio tiene receta con `nivelMinimo` por encima de 5. Para herrero, una primera lectura ("las 36 piezas `_bonificado(a)` nunca se pueden fabricar, solo caen de loot") resultó ser una falsa alarma propia — SÍ tienen un camino de crafteo real vía `resultadoPerfecto` (§7ter, un golpe 5★ en el minijuego de forja de la receta base las entrega directamente) que el primer script de auditoría no comprobó. El hueco real que SÍ sigue en pie: el nivel de oficio EN SÍ (más allá del minijuego de forja, que solo existe para herrero) no desbloquea ninguna receta nueva por encima de 5 en ningún oficio — sin cerrar todavía, pendiente real. Detalle completo (incluida la corrección) en `docs/GDD_Combate.md` §11sexies.

## 7bis. Planos ligados a mesas + niveles de oficio (pedido 2026-08-30)

Cierra varias de las preguntas abiertas de §7 (versión anterior de este documento). Confirmado por el streamer:

- *"los planos nuevos los vinculamos a mesas, si construyo nueva mesa mejor tengo mejores y más planos o blueprint, eso con cada oficio, empiezan con blueprints básicos"* — `RecetaCrafteo.planoRequerido?: string` (el campo ya existía en el schema, v1 lo dejaba sin comprobar) pasa a validarse de VERDAD: si una receta lo declara, exige que ESA construcción (típicamente una mesa de tier avanzado, un `EntradaConstruible`) exista YA levantada en el asentamiento — **exactamente el mismo mecanismo y el mismo código** que `edificioRequerido` (existencia en `ctx.vivas`, comprobado en `RoomExteriorBase.manejarCrafteoIniciar`, NO en `validarCrafteo` que sigue pura). No hay un "plano" persistido por jugador: el desbloqueo es "la mesa avanzada existe en el asentamiento", coherente con "si construyo una mesa mejor, tengo más planos" — construirla es lo que los desbloquea, para todo el asentamiento. Ausente = plano básico, cualquiera con la mesa normal puede intentar la receta desde el arranque ("empiezan con blueprints básicos").
- *"los niveles de oficio permiten poder usar mejores mesas, construir o poner las mejoras de mesa"* — nuevo campo `EntradaConstruible.nivelOficioMinimo?: { oficio, nivel }` (mesas en `interiores/catalogo/elementos.json`, o piezas exteriores en `exteriores.json`): al intentar `construir` esa pieza, `RoomExteriorBase.ts` comprueba `nivelDeXp(xpOficio) >= nivel` (mismo `obtenerXpOficio`/`nivelDeXp` que ya usa el resto de crafteo) ANTES de dejar colocarla — gatea tanto construir una mesa de tier alto como poner una mejora de mesa suelta, con el mismo campo (una "mejora" es, mecánicamente, otra pieza más de `EntradaConstruible`). Ausente = cualquiera construye (comportamiento de siempre, la inmensa mayoría de construibles).
  - "Tener alguna blueprint exclusiva por nivel" ya estaba cubierto por `RecetaCrafteo.nivelMinimo`, que `validarCrafteo` YA comprobaba desde antes de esta pasada — no hizo falta código nuevo, solo asignar el número en la receta cuando toque.
- *"por cada crafteo de esa blueprint asigna tú la cantidad de xp que da para subir nivel de oficio"* — `RecetaCrafteo.xpOtorgada?: number`, usado en `manejarCrafteoRecolectar` (`receta.xpOtorgada ?? XP_POR_CRAFTEO`) — ausente = cae al valor global de siempre, para no obligar a rellenar TODAS las recetas existentes de golpe.

**Sigue como contenido pendiente, no mecanismo** (pedido literal: *"las asignas tú y si no deja apuntado asignarlas a futuro"*): qué mesas concretas llevan `nivelOficioMinimo`, qué recetas llevan `planoRequerido`/`xpOtorgada` y con qué valores — es trabajo de catálogo oficio a oficio, igual que el resto de §7. El mecanismo de los tres campos está completo y probado (tsc + suite 785/785); les falta contenido real, no código.

**`nivelOficioMinimo` ya relleno para los 10 oficios de jugador finales** (docs/GDD_Profesiones.md §0, 2026-08-30): las mesas de nivel 1-4 de cada oficio ya llevan el campo. Esa misma pasada añadió, además, un mecanismo NUEVO y distinto — `EntradaConstruible.mejoraMesa` (módulos de velocidad/cantidad colocados ADYACENTES a una mesa, no un requisito de nivel para construirla) — ver GDD_Profesiones.md §0 para el detalle completo. `planoRequerido`/`xpOtorgada` siguen sin contenido real todavía.

## 7ter. Minijuego de forja — armas y armaduras de herrero (pedido 2026-09-01)

Partiendo de un prototipo externo (server+client con fases calentar/forjar/templar) que el streamer subió pidiendo opinión: *"generar para algunas [oficios] estos minijuegos en ciertos crafteos (en el de las armas y armaduras) por que podria conseguir bonus si lo hace perfecto"*, confirmando el alcance exacto: *"solo para las armas y armaduras, el resto de crafteos del errero no se hacen con el minijuego"*.

**Alcance — exactamente 30 recetas de herrero** (`items/catalogo/recetas.json`), las 9 de tipo `arma` (daga, espada_corta, hacha_combate, maza_guerra, lanza, arco_corto, espada_larga, arco_largo, ballesta) y las 21 de armadura de hierro/acero (gafas/coderas/manos/rodilleras/casco/brazos/zapatos/hombreras/piernas/mascara en ambos tiers + pechera_cota_malla + pechera_placas_acero) — **NO** las armaduras de cuero (oficio curtidor) ni las herramientas/instrumentos del propio herrero, que siguen el crafteo normal por temporizador (§5) sin tocar. Cada una de estas 30 recetas lleva ahora `minijuego: "herreria"` y `resultadoPerfecto: {itemId, cantidad}`.

**Motor puro** — `server/src/construccion/herreria.ts` (mismo patrón que `arenaCombate.ts`): 3 fases sobre una `SesionForja` mutada por acción, sin tick de servidor (dt perezoso desde `ultimaAccionEn`, igual que el resto de crafteo/curtido):
- **CALENTAR**: `avivarFuego` sube la temperatura y consume combustible (5 cargas); pasa a FORJAR a los 68°.
- **FORJAR**: 12 `golpearYunque` — la calidad de cada golpe sale de la posición de la aguja de ritmo **en el instante exacto** en que llega el mensaje. Server-autoritativo de verdad: la aguja la simula el propio servidor (`avanzar`, dentro de `herreria.ts`), nunca se confía en un `timing` que mande el cliente (a diferencia del prototipo original, que sí dejaba que el cliente declarase su propio timing).
- **TEMPLAR**: 1 acción, ventana de temperatura (no de timing — la temperatura ya baja sola, llegar tarde también penaliza).

**Que no salga siempre perfecto** (pedido: *"que fuera algo mas complicado para no salga siempre perfecta"*) — dos ejes de dificultad, ninguno presente en el prototipo original:
1. La velocidad de la aguja se **re-sortea tras cada golpe** (`rnd` inyectable, mismo criterio que `tirarHuida`) y crece con el progreso — no hay un tempo fijo que memorizar.
2. La ventana de "perfecto" se **estrecha según avanza la forja** (±0.13 en el primer golpe → ±0.08 en el último).

**Resultado perfecto = objeto de catálogo nuevo, no un bonus oculto en la instancia.** Decisión de diseño clave, verificada contra el código real antes de implementar: `SlotsEquipo` (`server/src/inventario/inventario.ts`) guarda **solo el itemId** por slot (`{[slot]: itemId}`) — al equipar, `equiparItem` descarta la instancia entera (durabilidad incluida) y `calcularStatsEquipo` lee `ataqueFisico`/`defensaFisica` **directo del catálogo por itemId**. Un "bonus" guardado como campo opcional en `ItemInstancia` (como si fuera `durabilidad`) se perdería en el momento de equipar — no sobrevive el pipeline real. Por eso un golpe perfecto (5★, `resultadoForja`) entrega **`receta.resultadoPerfecto`**: el mismo tipo de objeto pero una entrada de catálogo real aparte (`<id>_bonificado/a(s)`, 30 nuevas en `items/catalogo/items.json`, nombre calculado con `nombreBonito.js` como manda la regla de CLAUDE.md), mismo aspecto (`prendaId` sin cambios — "aunque se vea igual"), con `ataqueFisico`/`defensaFisica` +25% **fijo** (no aleatorio: el catálogo es la fuente de verdad, nada de un porcentaje calculado en caliente) — exactamente el mismo criterio que ya usa el catálogo para `casco_cuero`/`casco_hierro`/`casco_acero` (tres entradas de tier, no un multiplicador).

**Bloqueo de movimiento** (pedido: *"cuando este en el minijuego el pj no podra moverse, esta en el minijuego hasta que complete"*) — mismo mecanismo que el combate táctico (§9.3 de GDD_Combate.md): mientras `forjasEnCurso.has(sessionId)`, el handler genérico de `"input"` fuerza `x=y=0, correr=false`, servidor-autoritativo (no depende de que el cliente coopere).

**Protocolo** (`RoomExteriorBase.ts`) — arranca con el `crafteo:iniciar` de siempre (misma validación de mesa/nivel/insumos, insumos descontados AL INICIAR igual que el resto de crafteo, nunca devueltos si se cancela); si `receta.minijuego==="herreria"` responde `crafteo:herreria:iniciado` (con `cfg`/`sesion`) en vez de `terminaEn`. Mensajes nuevos: `crafteo:herreria:accion {accion:"avivar"|"golpear"|"templar"}` → `crafteo:herreria:progreso` (o, tras templar, resuelve y entrega de verdad: XP, suciedad, `entregarOSoltar`, y manda `crafteo:herreria:completado`); `crafteo:herreria:cancelar` → `crafteo:herreria:cancelado`. Un segundo `crafteo:iniciar` mientras hay una forja activa se rechaza (no se puede pisar la sesión); `onLeave` limpia `forjasEnCurso` igual que `craftesEnCurso`.

**Sin panel de cliente todavía** — mismo estado que el resto de crafteo (§5: "crafteo no tiene panel de cliente hoy"), protocolo real disponible vía `window.__test.enviar(...)`. Verificado end-to-end contra el servidor real (`server/test/herreria.e2e.mjs`: fases, doble-inicio bloqueado, cancelado limpio, insumos gastados al iniciar y nunca devueltos, entrega real base/bonificada según estrellas) además de la suite unitaria del motor puro (`server/test/herreria.test.ts`, 20 tests: cada fase, los dos ejes de dificultad, calidad/estrellas, simulación completa perfecta e imperfecta).

## 7. Fuera de alcance de esta propuesta (pendiente, oficio a oficio)

- Las recetas/planos concretos de cada oficio — esto solo fija el CONTRATO, no rellena los ~38 oficios.
- ~~Cómo se consigue un plano nuevo~~ — **resuelto (2026-08-30), ver §7bis: ligado a construir la mesa correspondiente, no a un desbloqueo por jugador.**
- Umbrales exactos de XP por nivel, y cuánto XP da cada receta — placeholders a afinar como el resto de números de balance del proyecto (`xpOtorgada` por receta ya es asignable desde §7bis, falta rellenarlo).
- Si un personaje puede tener varios oficios a la vez o hay que especializarse — sigue abierto en el Backlog.

## 8. Ampliación masiva de crafteo + velocidad/durabilidad real por tier + reparto 1-10 (2026-09-08, pedido streamer: "que todos los objetos del mundo ahora puedan craftearse (menos las armas y armaduras de bosses)... herramientas de diferentes materiales (las mas basicas mas lentas, las de mejor material mas rapidas y mas durabilidad) para asi repartirlas en los niveles como tiers")

Cierra dos huecos a la vez: (1) el "mapa de oficios" (artefacto visual pedido en la misma sesión) mostraba las 290 recetas topando en nivel 4-5, niveles 6-10 vacíos en los 10 oficios; (2) el tier de herramienta (1-4, `familiaMaterial: "herramienta_<oficio>"`) YA existía desde 2026-08-30 pero era **solo una puerta de acceso** — el propio código lo decía: "aunque hoy da igual, ninguna se destruye, solo se desgasta" — recolectar tardaba lo mismo con tier 1 que con tier 4, y la durabilidad era una constante plana (60) en vez de escalar.

### 8.1 Alcance real de "todos los objetos" — auditado antes de tocar nada

Antes de generar nada se hizo un barrido real de `items/catalogo/items.json` (614 entradas) cruzado contra `recetas.json` (290 recetas) por `tipo`, para separar el hueco REAL del ruido:

| tipo | sin receta | qué era de verdad |
|---|---|---|
| `armadura` | 35/35 | las 5 piezas × 7 temas de `catalogoLootLegendario.json` — **excluido a propósito, sigue siendo el único loot de jefe** |
| `arma` | 14/45 | 7 legendarias + 7 de `catalogoLootTematico.json` (enemigo temático) — **excluido, mismo criterio** |
| `equipable` | 7/123 | las 7 armaduras temáticas de `catalogoLootTematico.json` — **excluido** |
| `semilla` | 32/32 | se consiguen cosechando o comprando a NPC (confirmado por el streamer) — **fuera del reparto a propósito** |
| `libro` | 18/19 | casi todos son libros de TUTORIAL/lore — el único crafteable de verdad es el que el propio jugador puede escribir (concepto distinto, no una receta más) — **fuera de esta pasada** |
| `objeto` | 64/77 | 40 son `cadaver_*` (contenedor auto-generado al cazar, no se craftea) + moneda/reliquia/bolsas de semilla (atadas a la exclusión de arriba) — el resto (23: vajilla, iluminación, papelería, arcón...) **SÍ tiene receta nueva** |
| `recurso` | 90/162 | la mayoría es materia prima BRUTA (mineral, madera en tronco, plantas, carne, pieles) — se sigue recolectando/talando/cazando, NUNCA crafteando (decisión explícita del streamer: "solo procesados") — los 13 PROCESADOS reales (lingotes ×7, acero, bronce, piedra_tallada, cristal_pulido, cuero_curtido, tela_hilada, gema_tallada) + 4 muebles-que-también-son-ítem (silla/mesa_comedor/cama_individual/arcón) **SÍ ganan receta** |
| `consumible` | 28/35 | 5 son `pocion_alquimica_*` (minijuego de alquimia, `alquimia.ts::itemIdPocion` — ya tienen SU propio camino de crafteo, no uno de recetas.json) — el resto (23: asados, cocinados, pan, mantequilla, queso, raciones) **SÍ gana receta**, cocinero |

Total real: **89 recetas nuevas** sobre ítems que YA existían en el catálogo (cero arte nuevo, cero id nuevo salvo lo del §8.2/8.3) — el resto del "hueco" era ruido (loot exclusivo, subproductos automáticos, materia prima que se recolecta por diseño).

**Los 616 elementos de `interiores/catalogo/elementos.json` sin representación en `items.json`** (de 716 totales, solo 100 tienen un id gemelo en `items.json` — el resto es decorado puramente bakeado: clutter, arquitectura de sala, set-dressing de un taller concreto) se dejan **fuera a propósito** — convertirlos en ítems craftables exigiría darles entrada nueva en `items.json` (peso/categoría/pila) para CADA uno sin la garantía de que tenga sentido cargarlos y colocarlos como mueble de jugador (una bóveda de piedra o una viga de techo no son "un objeto que se lleva en la mochila"). Si el streamer quiere piezas concretas de esa lista crafteables, es una petición dirigida, no un barrido ciego.

### 8.2 Tier 5 — techo nuevo de herramienta por oficio (nivel 5, uno por familia)

Extiende la escalera `tier1→nivel1 ... tier4→nivel4` ya establecida con un quinto peldaño real: `martillo_yunque_celestial` (herrero), `hacha_corazon_roble_milenario` (carpintero), `pico_veta_eterna` (picapedrero), `cuchilla_maestra_talabartero` (curtidor), `buril_luz_prismatica` (joyero), `guadana_cosecha_dorada` (molinero), `podadera_sagrada_arboleda` (curandero), `compas_precision_estelar` (ingeniero), `cuchillo_rastreador_supremo` (cazador), `cuchillo_gran_maestro_cocina` (cocinero) — 10 ítems nuevos, cero arte nuevo (reusan un `prendaId` ya existente, el mismo mecanismo procedural que ya usan armas/herramientas desde 2026-09-07: `equipoVisual.ts` genera el vóxel EN VIVO o carga el `.glb` ya aprobado de `taller-vox/generar_herramientas.js`).

### 8.3 Pieza insignia por oficio (nivel 7-10) — el techo real por encima de lo craftable de siempre

11 ítems nuevos (uno o dos por oficio, herrero se lleva dos por ser el más profundo del catálogo), extendiendo el MEJOR producto ya existente de cada oficio un escalón más — mismo criterio que ya usa el juego para `_bonificado(a)` (mejor material, mejores stats), **nunca compitiendo con el loot legendario de jefe**: `martillo_guerra_mithril`(8)/`peto_placas_mithril`(10) herrero, `gran_salon_ebanisteria_carro_real`(7) carpintero, `coraza_marmol_reforzado`(8) picapedrero, `abrigo_piel_exotica_maestro`(7) curtidor, `diadema_gemas_reales`(9) joyero, `banquete_real_gran_asado`(7) cocinero, `elixir_restauracion_completa`(8) curandero, `ballesta_repeticion_maestra`(9) cazador, `automata_asistente_mecanico`(10) ingeniero, `silo_grano_gremial`(7) molinero.

### 8.4 Velocidad y durabilidad REALES por tier (no solo puerta de acceso)

`items.json`: las 66 herramientas con `familiaMaterial: "herramienta_<oficio>"` (de 71 — las 5 restantes, `cana_pesca`/`cubo_ordeno`/`tijeras_esquilar`/`antorcha_portatil`/`instrumental_cirugia`, nunca tuvieron tier, quedan fuera igual que antes) ganan `cooldownMs` (2200/1700/1300/950/700 ms por tier 1-5) y `durabilidadMax` escalado de verdad (50/90/140/200/280, antes una constante plana de 60 o ausente).

**`server/src/mundo/herramientasRecoleccion.ts`**: nueva función pura `msFaltantesParaRecolectar(cooldownMs, ultimoMs, ahoraMs)`. **`RoomExteriorBase.manejarCoger`**: nuevo `ultimoCogerPorSesion` (Map por sesión, limpiado en `onLeave`) — antes de confirmar una recolección GATEADA por herramienta (rama picapedrero equipada Y rama `mejorHerramientaPara`), comprueba el cooldown de la herramienta CONCRETA usada y rechaza con `coger:error {motivo:"demasiado_pronto", faltanMs}` si no ha pasado suficiente; recoger algo YA soltado por otro jugador sigue instantáneo, como siempre (nunca pasa por `requisitoDeCategoria`). Verificado con `server/test/herramientasRecoleccion.e2e.mjs` (gating real sin regresión) + `server/test/herramientasRecoleccion.test.ts` (17 tests: la función pura con timestamps fabricados + un test de catálogo que confirma que CADA familia mejora cooldown Y durabilidad tier a tier, no solo que existan los campos).

### 8.5 Monturas — 2 tiers nuevos sobre `silla_montar`, con bonus real (no solo cosmético)

`docs/GDD_Monturas.md` §3 ya tenía la silla básica (`esMontura`, consumida por `mascota:ponerMontura`, gatea `mascota:montar`) — pero era un flag booleano, sin distinguir QUÉ silla. Nuevo `bonusVelocidadMontura` en el catálogo (`silla_montar`=0, `silla_montar_reforzada`=0.1, `silla_montar_maestra`=0.2, nivel 3 y 6 respectivamente) que ahora SÍ se persiste por mascota (`Mascota.monturaBonusVelocidad`, columna nueva `montura_bonus_velocidad` migrada en los dos backends, mismo patrón que `arnesPesoMaximo`) y se aplica de verdad a `velocidadMontura` al montar (`manejarMascotaMontar`). Verificado: `server/test/mascotasBd.test.ts` (+1 test, roundtrip del bonus en BD), `server/test/monturas.e2e.mjs` sin regresión (la montura sembrada sin bonus explícito sigue moviéndose exactamente igual que antes — 0 es no-op).

### Verificado (§8, conjunto)

Servidor 1271/1271 (+7 tests nuevos: 5 de velocidad/durabilidad por tier, 2 de bonus de montura en BD), `tsc --noEmit` limpio en cliente y servidor (cliente sin cambios — `equipoVisual.ts` ya renderizaba genéricamente cualquier `prendaId`/material nuevo, cero pieza de arte nueva que aprobar), `items.json` 614→637 entradas (23 nuevas: 10 tier5 + 11 insignia + 2 tiers de montura), `recetas.json` 290→379 (89 nuevas), `server/test/herramientasRecoleccion.e2e.mjs`/`monturas.e2e.mjs`/`npcs_trabajadores_montura.e2e.mjs` sin regresión (el último tiene un fallo de timing PRE-EXISTENTE, confirmado reproduciéndolo igual con `git stash` sobre el commit limpio anterior a esta pasada — no es de esta pasada). **Reparto final por nivel** (recetas por oficio, 1→10): con esta pasada los 10 oficios tienen contenido real en 1-5 y AL MENOS una pieza en 6-10 (herrero e ingeniero llegan a nivel 10, el resto a 7-9) — antes de esta pasada, 9 de 10 oficios topaban en nivel 4. **Sin verificación visual en cliente real** (equipar una pieza insignia nueva y verla en pantalla, craftear un procesado y confirmarlo por Playwright) — documentado como gap, no dado por bueno sin más, mismo criterio honesto que el resto de esta sesión.
