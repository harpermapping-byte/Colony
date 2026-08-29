# GDD — Mecánicas de juego

Las REGLAS DEL MUNDO que cumple la simulación en vivo (`server/`). Este
documento es la referencia que las siguientes mecánicas (recursos,
combate, interiores…) deben respetar; si una mecánica cambia una regla,
se actualiza aquí en el mismo commit.

## 0. Principios

- **El servidor es la autoridad.** El cliente solo envía intención (dirección,
  bucear) y dibuja lo que el servidor dicta. Nada de física en cliente.
- **Unidades: casillas.** 1 casilla del mapa bakeado = 1 unidad de mundo del
  cliente. Las posiciones son floats en casillas; las velocidades,
  casillas/segundo. (Antes el servidor hablaba en px con 32 px = 1 casilla;
  se eliminó la conversión.)
- **El catálogo manda.** Qué bloquea y qué se nada NO está escrito en el
  código del servidor: sale de `baker/catalogo/terrenos.json`
  (`transitable`, `requiereNadar`, `modVelocidad`) y del campo `colision`
  de `vegetacion/rocas/animales.json`. El servidor construye su rejilla de
  colisión UNA vez al crear la room (`server/src/mundo/mapaColision.ts`).
- **Toda mecánica nace servidor-autoritativa y sincronizada** (regla MMO,
  detallada en §3.5): el cliente solo envía intención y pinta lo que el
  servidor dicta.

## 1. Colisiones (v1 — vigente)

Caja SENCILLA e igual para todo, por decisión de diseño (nada de hitboxes
por forma):

| Cosa | Caja | Regla |
|---|---|---|
| PJ (y futuros NPC/animales móviles) | AABB de radio 0.35 casillas | choca con sólidos; con otros PJ se EMPUJA, no se bloquea. Acordado 2026-08-27: cuando la fauna/NPCs sean entidades, su radio NO será fijo — se deriva del catálogo (`personajes/catalogo/animales_rig.json`: `anchoCuerpo/2 × escala` del individuo; NPCs: del torso morfado), nunca a mano ni por malla/vóxel. La vaca empuja como grande, el conejo como chico, la abeja casi nada. |
| Terreno `transitable: false` sin `requiereNadar` (roca_inaccesible, lava…) | su casilla entera | pared |
| Pieza de catálogo con `colision: true` (árboles con madera, todas las rocas/vetas, animales grandes) | su casilla entera | pared; solo endurece casillas de tierra |
| Terreno con `requiereNadar` (agua, agua_profunda) | — | NO es pared: es un MEDIO (ver §2) |
| Borde del mapa / chunk ausente | — | pared (los bordes "abiertos" se resolverán con cambio de instancia) |
| Fuera del mapa | — | pared |

- Movimiento eje a eje con "slide": chocar en X no anula el avance en Y.
  Al chocar, el PJ queda pegado al borde de la casilla (radio + ε).
- Subpasos de ≤ 0.25 casillas: ningún paso grande atraviesa una pared.
- PJ contra PJ: separación suave por pares (se reparten el empuje a partes
  iguales), re-validada contra los sólidos — nadie acaba dentro de una
  pared ni dos PJ se atascan mutuamente en un pasillo. O(n²) con
  `maxClients` 40: barato a 30hz.
- Interiores (edificios/muebles/paredes): misma regla de casilla cuando el
  cliente cruce puertas (pendiente; los muebles ya tienen casilla en su
  instancia bakeada).

## 2. Agua: nadar y bucear (v1 — vigente)

El agua es un medio con niveles de profundidad, no un obstáculo:

- Se entra ANDANDO (no hay salto): al pisar casilla con `requiereNadar`,
  el estado pasa a `nadando` (superficie, nivel 0).
- **Bucear**: el nivel baja de 1 en 1 — `agua` somera permite hasta **-1**,
  `agua_profunda` hasta **-2**. Al pasar de profunda a somera el nivel se
  clava a -1 solo; al pisar tierra, nivel 0 y estado `tierra`.
- Estados visibles en el schema (`Player.estado`): `tierra` | `nadando`
  (nivel 0) | `buceando` (nivel < 0). `Player.nivel`: 0, -1, -2.
- Velocidades (casillas/s): andar **3.75** × `modVelocidad` del terreno ·
  nadar **2.2** · bucear **1.7**. La diagonal va normalizada (no es más
  rápida).
- Cliente: Q baja / E sube (pulsación; el servidor valida el medio).
  Nadando el rig va medio hundido y tumbado; buceando se le ve a través
  del agua TRANSLÚCIDA descendiendo hacia el lecho. El agua se pinta en
  dos planos (`client/src/render3d/terreno.ts`): lecho a y=-1.5 sombreado
  con la elevación bakeada (hondo = oscuro) + superficie translúcida con
  el `colorDebug` del catálogo. No hizo falta tocar el bakeador: el mapa
  ya traía terreno y elevación por casilla.
- Pendiente (diseñado, no implementado): aire/ahogo al bucear, corrientes,
  y que los animales acuáticos solo colisionen bajo el agua.

## 3. Recursos y recolección (DISEÑADO, no implementado — acordado 2026-08-27)

La segunda mecánica, diseñada al detalle antes de codificar. El esqueleto
sobre el que se cuelga todo lo futuro (crafteo, cocina, comercio, misiones)
son los CATÁLOGOS, igual que interiores hizo con sus RoomTags.

### 3.1 Tags y materiales en el catálogo

- Cada especie de `vegetacion/rocas/animales.json` recibe **`tags`** (qué
  ES: `arbol`, `comida`, `mineral`, `hierba`, `valioso`…). Las mecánicas
  filtran por tag — "el pico pica `mineral`", "la misión pide 5 `hierba`" —
  y añadir especies nuevas no obliga a tocar ninguna mecánica. Mismo
  patrón que los RoomTags de interiores.
- `categoriaRecurso` (ya existe) dice QUÉ material da. Todo su valor debe
  existir en **`baker/catalogo/materiales.json`** (NUEVO): la lista de todo
  lo que puede vivir en un inventario — id, nombre, `tags`, tamaño de pila,
  `uso`. Fuente de verdad del inventario/crafteo/comercio para siempre.
- Cada especie recolectable recibe un bloque **`recoleccion`**:
  `herramienta` (obligatoria "en la mano" — ver 3.4), `da` (material +
  cantidad mín/máx), `golpes` (interacciones hasta agotarse) y
  `respawnSegundos`.

### 3.2 Golpes y agotado (decisión del usuario)

- **Plantas y cosas pequeñas** (hierbas, flores, setas, bayas): **1 golpe**
  → material → el prop desaparece para todos.
- **Árboles y menas**: aguantan **varios golpes** (3–5 por catálogo); cada
  golpe da material, al último el nodo desaparece.
- Los golpes restantes de un nodo son estado compartido igual que el
  agotado (ver 3.5) — dos jugadores pueden turnarse los golpes.

### 3.3 Respawn (decisión del usuario)

- **v1: en el sitio**, con cálculo PEREZOSO (nada de timers): "¿vivo?" =
  `ahora - agotadoEn > respawnSegundos`, evaluado al mirar el nodo.
- Tiempos **de juego** desde el principio: orientativo hierbas ~5 min,
  árboles ~15 min, menas ~30 min (afinable por catálogo).
- **Excepción para testear**: UNA especie de cada tipo lleva tiempo corto
  marcado con `_nota` de "tiempo de test, retirar tras testeo" (p. ej.
  lavanda 30 s, arbol_joven 60 s, guijarros 45 s).
- **v2 (diseñado, después)**: reaparición EN OTRO PUNTO del pool de spawn
  regional que ya marca el bakeador, determinista (semilla + contador del
  nodo). Pensado para bayas/setas/animales; árboles y menas se quedan en
  respawn en sitio.

### 3.4 Herramientas y equipamiento (decisión del usuario)

- La estructura nace YA con herramienta obligatoria: cada `recoleccion`
  declara la suya (`hacha` para tag `arbol`, `pico` para `mineral`, `hoz`/
  `mano` para `hierba`…), y el jugador tiene un slot de EQUIPO **"mano"**
  en su estado (el germen del equipamiento general: lo que llevas en la
  mano es lo que usas — recolectar hoy, combate mañana).
- **v1: la validación va desactivada** (la mano vale para todo) — pero el
  campo, el slot y el chequeo existen desde el primer día para encenderlos
  cuando existan herramientas que conseguir.

### 3.5 Sincronización MMO (REGLA TRANSVERSAL para TODA mecánica)

Prioridad número uno del proyecto, fijada aquí como principio:

> **Toda mecánica nace servidor-autoritativa y sincronizada: el cliente
> solo envía intención y pinta lo que el servidor dicta. Nada de estado de
> juego decidido en cliente, nunca.**

Aplicado a recursos:

- **Identidad estable de nodo = su casilla** (clave numérica
  `x + y*ancho`): derivada del mapa bakeado, idéntica para todos los
  clientes y estable entre reinicios. Sin ids inventados.
- **Flujo**: cliente envía `recolectar` (tecla **F**, casilla que tiene
  delante) → el servidor valida (nodo existe y está vivo, jugador
  adyacente, herramienta si aplica, hueco en inventario) → descuenta
  golpe / marca agotado con timestamp → mete el material en el inventario
  → el cambio llega a todos por el patch normal. Si dos recolectan a la
  vez, el orden de llegada decide: el segundo recibe "agotado". Imposible
  duplicar.
- **Sincronización barata**: NO se replica el estado de miles de props —
  solo el diccionario de **nodos tocados** (casilla → golpes restantes /
  timestamp de agotado). Todo lo demás se deduce del mapa bakeado que
  todos tienen. Cambios, no snapshots.
- **Inventario**: en el estado del jugador (material → cantidad + slot
  mano). v1 sin UI: contador simple en pantalla.
- Cliente: el prop agotado se oculta en su `InstancedMesh` (el cliente ya
  indexa por casilla al instanciar) y reaparece al revivir.

## 4. Aparición

Al entrar a la room se aparece en la `ciudad` del índice del mapa,
corregida a la casilla de TIERRA pisable más cercana (búsqueda en anillos).

## 5. Sistemas RPG — guía maestra (VISIÓN acordada 2026-08-27; cada sistema se pule aquí antes de codificarse)

El MMO RPG "al uso" que persigue el proyecto, apuntado para que cada
mecánica nueva encaje en este esqueleto en vez de improvisarse. Regla de
oro repetida: catálogo como fuente de verdad + servidor autoritativo
(§3.5) en TODOS estos sistemas.

### 5.1 EXP y habilidades (configurar DESDE EL INICIO)

- Modelo por HABILIDADES que suben con el uso (estilo RuneScape/UO):
  recolectar madera sube `lenador`, minar sube `mineria`, craftear sube la
  profesión de la receta, y "casi todas las acciones" dan EXP a la
  habilidad que les corresponde.
- **`catalogo/habilidades.json`** (futuro): id, nombre, `uso`, curva de
  EXP por nivel (una sola fórmula global parametrizada, no una tabla por
  habilidad), y qué desbloquea cada tramo (blueprints, herramientas).
- **Un único punto de otorgamiento en el servidor**: toda mecánica emite
  un evento `accion(habilidad, exp)` a un módulo central de progresión —
  así el "qué da EXP" vive en el catálogo de cada cosa (la especie dice la
  EXP de recolectarla, la receta la de craftearla) y nunca desperdigado
  por el código. Esto es lo que hay que dejar montado desde la primera
  mecánica que dé EXP (recolección).
- Habilidades del PJ = estado persistente del jugador (ver 5.7).

### 5.2 Crafteo con blueprints y profesiones

- **`catalogo/recetas.json`** (futuro): ingredientes (materiales +
  cantidades), estación necesaria, habilidad + nivel mínimo, EXP que da,
  resultado (+ cantidad). Los blueprints son conocimiento del PJ: una
  receta se APRENDE (drop/compra/nivel) y pasa a su lista aprendida.
- **Las estaciones de crafteo son los muebles de interiores**: la forja,
  el banco de carpintero o el telar ya existen en el catálogo de
  interiores con sus RoomTags — la receta referencia el tag del mueble
  (`forja`), no un mueble concreto. Sinergia directa con lo ya construido.
- Craftear = interacción validada en servidor: consume ingredientes,
  produce resultado, da EXP. Atómico (nunca puede quedar a medias).

### 5.3 Inventario: rejilla tipo Tetris + peso (decidido)

- Cada objeto de `materiales.json` define **`tamano: [ancho, alto]`** en
  celdas y **`peso`** por unidad. El inventario es una REJILLA en la que
  los objetos ocupan su silueta (encajar como Tetris) Y a la vez suma un
  PESO total contra la capacidad del PJ.
- **Stack**: el mismo material apila en una celda hasta su pila máxima; el
  peso del stack es peso unitario × cantidad (stackear no descuenta peso).
- Capacidad de peso = base del PJ + atributos + equipo (5.4). Pasarse de
  peso PENALIZA VELOCIDAD progresivamente, estilo Project Zomboid (no
  bloquea coger) — decidido por el usuario 2026-08-27.
- Servidor autoritativo también en la COLOCACIÓN: mover un objeto en la
  rejilla es un mensaje validado (anti-duplicación); el inventario de cada
  jugador solo se sincroniza a su dueño (filtrado por cliente de
  Colyseus).

### 5.4 Equipamiento y atributos (decidido en líneas generales)

- Slots de equipo: **mano** (ya diseñado en §3.4 — herramienta/arma),
  cabeza, torso, piernas, pies, espalda… La ropa/armadura da **defensa**,
  puede dar **capacidad de peso** extra, y las bolsas/mochilas añaden
  REJILLA extra de inventario (otro grid anidado).
- Los equipables viven en el mismo catálogo de objetos con tag
  `equipable` + su slot + sus stats (nada de catálogo aparte).

#### Vida / Ataque / Defensa (✅ implementado, pedido 2026-08-30)

Reglas pedidas explícitamente, diferenciadas por tipo de entidad:

- **Animales**: NUNCA tienen defensa — su única resistencia es la vida
  máxima. Sí tienen ataque. La vida máxima escala por categoría
  (`categoriaVida` en `baker/catalogo/animales.json`, derivada del
  `tamanoReproduccion`/`peligroso`/`colision` ya existentes, un valor por
  especie — no aleatorio): cría ~8, pequeño 15-25, mediano 50-65, grande
  100-200, alfa 300+ (hoy solo tiburón/orca/araña gigante/calamar
  gigante caen en "alfa", por ser `colision + peligroso` a la vez).
- **Jugadores y NPCs humanoides**: SÍ tienen ataque y defensa. Todo
  jugador arranca con **100/100 HP** obligatorio. `ataque`/`defensa` son
  campos numéricos en el Schema de red (`Player.ataque`/`Player.defensa`,
  base 3/0 — a puño limpio, sin armadura) pensados para subir con
  equipo/atributos/magia MÁS ADELANTE: esta pasada NO conecta ningún
  cálculo de equipo todavía (nadie lee del inventario ni de catálogo de
  items al golpear) — es la base numérica sobre la que enganchará
  cualquier sistema de equipo/combate futuro, esta pasada u otra.
- **Fórmula de daño** (`server/src/combate/combate.ts`, módulo puro):
  `daño = max(1, ataque - defensa)` — nunca menos de 1. Para un animal,
  quien llama pasa `defensa: 0` siempre (no tienen esa estadística), así
  que reciben el ataque tal cual.
- **Regeneración/curación**: NADIE se cura solo con el tiempo — ni
  jugadores, ni animales, ni NPCs. Un jugador solo sube vida comiendo
  (fuera de combate) o con pociones/magia; animales y NPCs solo si un
  jugador los cura A PROPÓSITO con un objeto o magia. Por eso
  `combate.ts` no tiene ninguna función de "tick" de vida — `curar()` es
  siempre un evento explícito.

Piezas: catálogo de vida de fauna (`server/src/mundo/catalogoCombateFauna.ts`,
separado del catálogo de reproducción porque cubre TAMBIÉN crías y
población infinita, que no reproducen pero sí pueden recibir daño);
persistencia (`fauna_salvaje.vida/vida_max/ataque` — el daño sufrido
sobrevive a desactivar/reactivar un sector; `jugadores.vida/vida_max`);
Schema de red (`Player`/`Npc`/`Fauna` en `HubState.ts`, con barra de
vida flotante en el cliente, `client/src/render3d/worldScene.ts`);
`GestorFaunaSalvaje.recibirDanio`/`curarIndividuo` (mismo patrón
"mecanismo listo, punto de enganche" que `matarIndividuo`/cadáveres); y
UN disparador real ya cableado: el mensaje `combate:atacar` de
`HubRoom.ts` (jugador ataca fauna salvaje activa o a otro jugador,
dentro de `RADIO_INTERACCION`, servidor autoritativo) — un animal salvaje
muerto en combate crea su cadáver automáticamente (cierra el círculo con
el sistema de cadáveres de la fase anterior).

**Deliberadamente fuera de esta pasada**: NPCs humanoides con id
persistente (bandidos/`tropas_asentamiento`) no tienen ninguna entidad
viva en red todavía (confirmado: sin disparador de combate real, ver
GDD_Faccion_Bandidos.md §2.4) así que no reciben daño; los NPCs civiles
de asentamiento SÍ tienen stats de combate en su Schema pero nadie los
ataca (no hay id estable ni ataque cuerpo a cuerpo de NPC hacia jugador);
sin muerte "de verdad" de jugador — morir en PvP hoy simplemente rellena
la vida al máximo en el sitio, sin respawn ni penalización (no había
diseño de eso pactado); sin cooldown/animación/rango de arma más allá
del radio de interacción genérico; sin armaduras todavía (solo armas,
ver abajo).

#### Catálogo de armas (✅ items del catálogo, pedido 2026-08-30)

13 entradas nuevas en `items/catalogo/items.json`, `tipo:"arma"` (ya
declarado en el union `TipoItem` por la propuesta de `GDD_Combate.md`,
reutilizado tal cual — mismos campos `ataqueFisico`/`alcance`/
`cooldownMs`/`durabilidadMax`/`desgastePorUso`, sin inventar un segundo
esquema de stats):

- **Cuerpo a cuerpo** (alcance 1-3 casillas): `daga`, `espada_corta`,
  `espada_larga`, `hacha_combate` (distinta de `hacha_talar`, que sigue
  siendo herramienta de tala sin stats de combate), `maza_guerra`,
  `lanza`.
- **A distancia** (alcance 4-9 casillas, más lentas — `cooldownMs`
  mayor): `honda`, `arco_corto`, `arco_largo`, `ballesta`. Cada una
  declara `municionId` (campo nuevo en `EntradaCatalogoItem`) apuntando
  a su munición compatible.
- **Munición** (`tipo:"municion"`, nuevo valor del union `TipoItem`,
  apilable, sin `slotEquipo` — se consume, no se equipa): `piedra_honda`,
  `flecha`, `virote_ballesta`.

Todas con `familiaMaterial`/`tier` (encajan en cadenas de refinamiento
futuras de `docs/GDD_Crafteo.md`) y desgaste (`durabilidadMax`/
`desgastePorUso`, mismo `server/src/inventario/desgaste.ts` ya probado).

**Fuera de esta pasada**: recetas de crafteo para fabricarlas (hoy solo
existen como ítems, sin receta en `items/catalogo/recetas.json`); nadie
CONSUME `municionId` todavía (ni se resta munición del inventario al
disparar, ni el mensaje `combate:atacar` distingue melee de distancia —
sigue siendo un único `ataque` plano en `Player`); armaduras (solo hay
armas esta pasada, el pedido fue explícito: "de momento... mele y
arcos/ballestas/hondas").

**⚠️ SUSTITUIDO (decisión del streamer, 2026-08-30) — ✅ el táctico ya
está en pie.** Este sistema de daño DIRECTO simple (radio de
interacción, sin turnos) queda **INTERINO**: `docs/GDD_Combate.md`
(combate táctico por turnos en rejilla) es ahora el sistema definitivo,
YA implementado y probado contra el servidor real (`CombateSchema`,
mensajes `combate:iniciar/mover/accion/pasarTurno/huir`, panel de
cliente placeholder, autosimulación NPC-vs-fauna) — ver ese documento
para el detalle completo. Este `combate:atacar` sigue funcionando sin
tocar (no se ha borrado nada) hasta que se decida retirarlo. Excepción
confirmada: cuando NINGÚN combatiente es un jugador (NPC vs animal, NPC
vs NPC) el sistema definitivo tampoco usa turnos interactivos — se
autosimula de golpe (ver `docs/GDD_Combate.md` §7). Los campos/Schema
de vida que sí quedan
(`Player.vida/vidaMax`, `Fauna.vida/vidaMax/ataque`, persistencia en
BD, catálogo de vida de fauna, cadáveres) no se tiran — el sistema
táctico los reutiliza como su fuente de HP, no inventa unos nuevos.

### 5.5 Objetos por el suelo (persistencia visible, decidido)

- Dropear un objeto lo saca del inventario y crea un **prop en su casilla
  visible para TODOS**, durante MUCHO tiempo (orientativo: días de juego,
  no minutos) — la sensación de mundo persistente que se busca.
- Mismo patrón de estado que los nodos de recurso: diccionario compartido
  `casilla → {material, cantidad, caducidad}` con expiración PEREZOSA, y
  un tope de drops por chunk (el exceso caduca antes) para que el free
  tier no acumule basura infinita.
- Recoger un drop = misma interacción F validada en servidor (el primero
  que llega se lo lleva).

### 5.6 NPCs con IA conversacional y jugador-a-jugador (visión)

- NPCs con ficha propia (personalidad, oficio) que **responden con IA y
  tienen memoria interna** (resumen persistente de lo que han vivido/
  hablado, no transcripciones enteras). La respuesta es asíncrona: el
  juego nunca espera a la IA en el tick de simulación.
- Restricción dura: **todo gratis** → capa de proveedor intercambiable con
  presupuesto de llamadas (free tiers de APIs de LLM son limitados),
  respuestas cacheadas para charla trivial, y la memoria en el mismo
  almacén persistente que el resto (5.7). **✅ Resuelto e implementado**
  (`server/src/ia/`, ver `docs/GDD_IA_NPCs.md`): Gemini como proveedor
  principal con Groq de respaldo automático si falla, memoria por
  (NPC, jugador) recortada + búsqueda por similitud (RAG) para no repetir
  respuestas, rate-limit de 3s por jugador en `HubRoom.ts` (mensaje
  `npc:hablar`). Pendiente real: el contexto de mundo que recibe el
  proveedor sigue siendo un placeholder genérico, no la biografía
  individual que ya genera `poblacion/generarHistoria.js` — falta cablear
  eso, y no se ha probado contra las API reales desde este entorno (sin
  salida de red aquí; sí cubierto por tests con proveedores falsos).
- Interacción jugador-jugador: comercio con intercambio ATÓMICO arbitrado
  por servidor (ambos confirman → se ejecuta entero o nada), chat, y más
  adelante grupos/gremios. Nada de tratos peer-to-peer sin árbitro.

### 5.7 Persistencia (transversal)

Habilidades, inventario, equipo, drops en el suelo y nodos tocados deben
sobrevivir a reinicios del servidor — y el free tier de Render DUERME el
proceso y no tiene disco persistente. **✅ Resuelto e implementado**
(`server/src/datos/bd.ts`): interfaz `IAlmacenDatos` con dos motores —
SQLite local (`node:sqlite`) para desarrollo/tests, Postgres (Neon free
tier) en producción, elegido automáticamente por `DATABASE_URL`, mismo
contrato async en los dos. Usado hoy por el sistema de Construcción
(`docs/GDD_Construccion.md`) con escritura al cambiar, nunca por tick.
✅ Desplegado y VIVO (2026-08-28): el servicio bueno es **`colony-server`**
(runtime Node, Frankfurt, free) en `https://colony-server.onrender.com`,
con auto-deploy en cada push a main — Render no permite cambiar el runtime
de un servicio ya creado, así que el servicio viejo "Colony" (Docker, URL
`secret-1-secz`) quedó obsoleto y hay que suspenderlo/borrarlo desde su
dashboard para no quemar minutos de build. El cliente
(`client/src/config.ts`) apunta solo: `VITE_COLYSEUS_URL` manda si existe;
sin ella, localhost en desarrollo y `wss://colony-server.onrender.com` en
producción (Vercel funciona sin configurar nada en su dashboard). Ojo free
tier: el proceso DUERME tras ~15 min sin tráfico y la primera conexión
tarda ~50 s en despertarlo — esperado, no es un fallo.

### 5.8 Vivienda: constructor/decorador de interiores para jugadores (pedido por el usuario)

- El jugador tiene (compra/gana) un edificio propio y lo DECORA él mismo.
  La base ya existe entera: el motor de interiores con su catálogo de
  ~140 muebles, edición NO destructiva y colocación validada por RoomTags
  — el "modo decorador" del jugador es una versión in-game del editor web
  de `interiores/`, con las mismas reglas de colocación.
- Los muebles se CRAFTEAN (5.2) o se compran (5.9), viven en el inventario
  como objetos y al colocarlos pasan a ser estado del interior (instancia
  con su room propia, ver 5.11-zonas).
- Permisos: dueño (edita), invitados (entran), público (tienda, 5.9).
- Fase 2: construir/ampliar la estructura (paredes, habitaciones) con el
  generador de interiores como base — decorar primero, construir después.

### 5.9 Economía, moneda y tiendas (pedido por el usuario)

- UNA moneda. Entra al mundo por fuentes contadas (venta a NPC, misiones,
  eventos) y SALE por sumideros (compras a NPC, reparaciones, impuestos de
  tienda/vivienda) — sin sumideros un MMO se infla, así que cada fuente
  nueva se apunta aquí con su sumidero.
- **Tienda de jugador**: un mueble-mostrador en su vivienda (5.8) donde
  deja objetos con precio; vende incluso con el dueño desconectado. La
  compra es el mismo intercambio ATÓMICO arbitrado de siempre (objeto ↔
  moneda, entero o nada).
- Vendedores NPC con inventario limitado que rota (cálculo perezoso, no
  timers), precios fijos al principio (nada de economía dinámica hasta
  que haya datos reales).

### 5.9bis Fauna y NPCs como entidades vivas (acordado 2026-08-27)

Los animales serán COMO los PJ: entidades del servidor con posición
sincronizada, animación por pivotes y colisión propia — no props del bake.
Reglas pactadas con el usuario:

- **Visual**: cada individuo se materializa con el creador de personajes
  (`personajes/generarAnimal.js` → `client/render3d/animalVoxel.ts`, YA
  implementado y probado con la plaza demo de la ciudad) — determinista por
  semilla, animación idle por esqueleto y ciclo de andar por contrafase ya
  listos. El servidor solo sincroniza `especieId + semilla + x,y + estado`
  (andando/parado/nadando...): el cliente genera el cuerpo localmente,
  como con los PJ. Nada de mallas por la red.
- **Colisión**: radio derivado del catálogo (ver tabla de §1) — jamás por
  malla o vóxel; la física vive en casillas + radios, los vóxeles son SOLO
  visuales (la optimización gorda del proyecto).
- **IA solo para quien la necesita, y por presupuesto**: cada especie
  declarará su comportamiento en catálogo (`pasivo_errante` — pasea y pace;
  `huidizo` — conejo/ciervo huyen del PJ cercano; `agresivo` — lobo/oso
  persiguen; `estatico` — abeja/mariposa solo deambulan visualmente). El
  servidor simula SOLO la fauna con jugadores cerca (mismo principio que el
  streaming de sectores: lo lejano no cuesta), con tope de entidades
  activas por room — Render free manda. Las especies `estatico` pueden
  incluso vivir solo en cliente (deambulan sin verdad de servidor: no
  interactúan, no cuestan red).
- **Animación**: solo entidades con esqueleto; pausar el idle fuera de
  pantalla/lejos cuando haga falta (el bucle de animables ya está
  centralizado en `game.ts` — es un `if` de distancia).

**Monturas (acordado 2026-08-27).** Habrá animales montables: el PJ se
sube encima y **se convierten en UNA sola cosa** a todos los efectos.
Reglas pactadas para cuando se implemente:

- **Servidor — una entidad física**: montar fusiona los dos cuerpos en uno.
  Se simula SOLO la montura (su velocidad, su radio de colisión, su medio —
  un caballo no bucea) y el PJ deja de tener cuerpo propio: va anclado. El
  input del jugador mueve a la montura. Desmontar los separa de nuevo en
  dos entidades. Nada de simular dos cuerpos "pegados" — es la misma regla
  de la ropa: lo montado no tiene física propia.
- **Cliente — colgar del pivote, como la ropa**: el rig del PJ se cuelga
  del pivote `cuerpo` de la montura en su punto de silla y HEREDA la
  animación gratis (galopa la montura, el jinete se mueve con ella — cero
  código de sincronización). La pose sentada es rotar los pivotes de
  piernas del rig, que ya existen.
- **Catálogo como siempre**: `montable: true` en la entrada de la especie
  (`personajes/catalogo/animales_rig.json`) + su `velocidadMontura`. El
  punto de silla NO se escribe a mano: se deriva de las proporciones
  (centro del lomo = `altoPata + altoCuerpo`), así cualquier especie que se
  marque montable funciona sola — caballo, camello, o lo que se invente.
- **Solo esqueletos que aguanten**: montable es un flag por especie, no por
  plantilla — el burro sí, el conejo no, aunque compartan esqueleto.

### 5.10 Combate PvE y PvP (pedido por el usuario)

- Mismo esqueleto que todo lo demás: el arma es lo que llevas en la MANO
  (slot de §3.4/5.4), sus stats salen del catálogo de objetos, la defensa
  del equipo puesto, y el servidor resuelve cada golpe (alcance por
  casillas, cooldown por arma, daño = arma vs defensa; nada calculado en
  cliente).
- **PvE**: requiere fauna/criaturas MÓVILES — hoy los animales son props
  estáticos bakeados. El paso previo es "despertar" a los que tengan tag
  hostil/cazable: entidades con IA sencilla en servidor (deambular,
  huir/agredir por cercanía), simuladas SOLO cerca de jugadores activos
  (regla de oro del free tier) y ancladas a los pools de spawn bakeados.
- **PvP**: por ZONAS, nunca global: el Hub y las viviendas son seguros;
  regiones salvajes/mazmorras marcan PvP activado (el mapa bakeado ya
  tiene regiones/POIs donde colgar la bandera de zona).
- **Muerte**: ⚠️ decisión pendiente (qué se pierde: ¿nada / moneda / drops
  parciales del inventario?). El respawn es en el Hub. Se decide cuando se
  diseñe combate en detalle; las animaciones de pegar reutilizan el rig y
  los clips glTF del taller de PJ.

### 5.11 Twitch: jerarquía, títulos y viewers (pedido por el usuario)

- Los ROLES del chat de Twitch (mod, VIP, sub, viewer) se traducen en
  TÍTULOS visibles sobre el PJ y en la jerarquía social del pueblo del
  streamer. Perks COSMÉTICOS y sociales (título, color de nombre, acceso a
  zonas sociales), nunca ventaja de poder — el poder se gana jugando.
- La vinculación cuenta-Twitch ↔ PJ es parte de la identidad persistente
  (5.7). Los títulos se refrescan al conectar (rol actual del canal).
- Viewers desde el chat (visión ya en CLAUDE.md): comandos que influyen en
  el mundo (eventos, regalos, votar) — cada comando es un mensaje más al
  servidor autoritativo, con presupuesto/rate-limit por viewer.
- El STREAMER es el administrador: comandos GM (teleport, spawn de evento,
  kick/ban) reservados a su cuenta.

### 5.12 Sistemas que faltaban para cerrar el esqueleto (propuestos y aceptados a pulir)

- **Muerte y respawn** (transversal a PvE/PvP/supervivencia): qué se
  conserva, dónde se reaparece, penalización. Sin esto ninguna mecánica de
  riesgo tiene dientes. (Decisión pendiente, ver 5.10.)
- **Zonas e instancias**: el mapa ya es Hub + instancias por diseño; aquí
  se fijan las REGLAS por zona (seguro/PvP, se puede construir/decorar,
  capacidad de la instancia, qué rooms de Colyseus abre cada una). Es el
  paraguas de vivienda (5.8), PvP (5.10) y mazmorras futuras.
- **Fauna móvil / IA de criaturas**: prerequisito de PvE y de la caza;
  descrito en 5.10. También da vida al mundo sin combate (ciervos que
  huyen).
- **Ciclo día/noche y tiempo de mundo**: reloj de mundo PEREZOSO (hora =
  función del timestamp, nada que simular); condiciona spawns nocturnos,
  horarios de NPCs y luz del cliente. Barato y da muchísima atmósfera.
- **Comida y descanso (supervivencia LIGERA)**: da uso real al tag
  `comida` y a las camas de interiores — comer/dormir da buffs (velocidad,
  EXP), NO muerte por hambre (esto es un MMO social de stream, no un
  survival duro). ⚠️ A confirmar tono con el usuario.
- **Misiones/encargos**: NPCs piden "N objetos de tag X" (los tags hacen
  las misiones genéricas y baratas de crear); recompensa moneda/EXP/
  blueprints. Primer uso real de los NPCs antes incluso de la IA
  conversacional.
- **Chat y social in-game**: chat local/global, emotes del rig, grupos
  (party) para PvE y reparto de botín; gremios mucho después.
- **Eventos de mundo**: invasiones, ferias, apariciones raras —
  disparados por el streamer o por hitos de viewers (5.11). Contenido de
  stream puro con el esqueleto de zonas + spawns.
- **Administración y anti-abuso**: además de los comandos GM del streamer,
  rate-limit por mensaje, validación estricta de TODOS los inputs (ya es
  la norma) y registro de acciones económicas (auditar duplicaciones).

### 5.13 Orden de construcción propuesto (actualizado)

**Fase A — bucle de juego base**: 1. recursos v1 (§3) + inventario simple
→ 2. módulo EXP/habilidades + PERSISTENCIA (5.7, la decisión gorda) →
3. inventario rejilla+peso (5.3) → 4. equipo/slots (5.4) → 5. crafteo
(5.2) → 6. drops en suelo (5.5).
**Fase B — mundo vivo**: 7. día/noche → 8. fauna móvil → 9. combate PvE
(5.10) → 10. comida/descanso ligero → 11. misiones.
**Fase C — sociedad**: 12. moneda + tiendas NPC (5.9) → 13. zonas e
instancias formales → 14. vivienda/decorador (5.8) → 15. tiendas de
jugador → 16. comercio jugador-jugador → 17. chat/grupos.
**Fase D — el stream y la IA**: 18. Twitch títulos/jerarquía (5.11) →
19. comandos de viewers + eventos → 20. PvP por zonas → 21. NPCs IA
conversacional (5.6).
Cada paso entra por su sección de este GDD, se pule, y solo entonces se
codifica. El orden dentro de cada fase es flexible; entre fases, no mucho.

## 6. Cómo se prueba (obligatorio antes de tocar estas reglas)

- `cd server && npm test` — suite pura de colisiones (8 tests: bloqueo,
  slide, bordes, agua como medio, niveles, empuje PJ-PJ, mapa demo real).
- `cd client && node test/mecanicas.e2e.mjs` — juego REAL (Colyseus + Vite
  + Playwright): spawn, entrar al lago, bucear a -2, salir, y pared que
  clava al PJ en el borde. Lee la verdad del servidor vía
  `window.__colonyDebug` (solo del jugador local).
