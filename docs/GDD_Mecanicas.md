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

## 5. Cómo se prueba (obligatorio antes de tocar estas reglas)

- `cd server && npm test` — suite pura de colisiones (8 tests: bloqueo,
  slide, bordes, agua como medio, niveles, empuje PJ-PJ, mapa demo real).
- `cd client && node test/mecanicas.e2e.mjs` — juego REAL (Colyseus + Vite
  + Playwright): spawn, entrar al lago, bucear a -2, salir, y pared que
  clava al PJ en el borde. Lee la verdad del servidor vía
  `window.__colonyDebug` (solo del jugador local).
