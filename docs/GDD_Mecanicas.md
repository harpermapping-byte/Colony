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
| PJ (y futuros NPC/animales móviles) | AABB de radio 0.35 casillas | choca con sólidos; con otros PJ se EMPUJA, no se bloquea |
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
  peso: penaliza velocidad (no bloquea coger — a afinar).
- Servidor autoritativo también en la COLOCACIÓN: mover un objeto en la
  rejilla es un mensaje validado (anti-duplicación); el inventario de cada
  jugador solo se sincroniza a su dueño (filtrado por cliente de
  Colyseus).

### 5.4 Equipamiento y atributos (decidido en líneas generales)

- Slots de equipo: **mano** (ya diseñado en §3.4 — herramienta/arma),
  cabeza, torso, piernas, pies, espalda… La ropa/armadura da **defensa**,
  puede dar **capacidad de peso** extra, y las bolsas/mochilas añaden
  REJILLA extra de inventario (otro grid anidado).
- Atributos del PJ: **vida**, defensa (derivada del equipo), capacidad de
  peso, velocidad… — pocos y claros al principio; la lista exacta se
  cierra cuando se diseñe combate.
- Los equipables viven en el mismo catálogo de objetos con tag
  `equipable` + su slot + sus stats (nada de catálogo aparte).

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
  almacén persistente que el resto (5.7). ⚠️ Decisión pendiente: qué
  proveedor/es gratuitos y qué límites de uso por NPC/jugador.
- Interacción jugador-jugador: comercio con intercambio ATÓMICO arbitrado
  por servidor (ambos confirman → se ejecuta entero o nada), chat, y más
  adelante grupos/gremios. Nada de tratos peer-to-peer sin árbitro.

### 5.7 Persistencia (transversal, ⚠️ LA decisión pendiente más importante)

Habilidades, inventario, equipo, drops en el suelo y nodos tocados deben
sobrevivir a reinicios del servidor — y el free tier de Render DUERME el
proceso y no tiene disco persistente. Hace falta un almacén externo
gratuito (candidatos: Postgres free tier tipo Neon/Supabase, o similar)
con escritura PEREZOSA (guardar al salir el jugador + snapshot periódico
espaciado, nunca cada tick). Decidir esto ANTES de implementar EXP e
inventario, porque son los primeros datos que duele perder.

### 5.8 Orden de construcción propuesto

1. Recursos v1 (§3) + inventario simple (contador) → 2. módulo central de
EXP/habilidades + persistencia (5.7) → 3. inventario rejilla+peso (5.3) →
4. equipo/slots (5.4) → 5. crafteo con recetas y estaciones (5.2) →
6. drops en suelo (5.5) → 7. comercio jugador-jugador → 8. NPCs IA (5.6).
Cada paso entra por su sección de este GDD, se pule, y solo entonces se
codifica.

## 6. Cómo se prueba (obligatorio antes de tocar estas reglas)

- `cd server && npm test` — suite pura de colisiones (8 tests: bloqueo,
  slide, bordes, agua como medio, niveles, empuje PJ-PJ, mapa demo real).
- `cd client && node test/mecanicas.e2e.mjs` — juego REAL (Colyseus + Vite
  + Playwright): spawn, entrar al lago, bucear a -2, salir, y pared que
  clava al PJ en el borde. Lee la verdad del servidor vía
  `window.__colonyDebug` (solo del jugador local).
