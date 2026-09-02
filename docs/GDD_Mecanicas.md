# GDD — Mecánicas de juego

Las REGLAS DEL MUNDO que cumple la simulación en vivo (`server/`) — colisión,
agua, aparición, y las reglas de vida/ataque/defensa que el resto de
sistemas de combate/fauna citan como fuente. Este documento es la
referencia que las demás mecánicas deben respetar; si una regla de estas
cambia, se actualiza aquí en el mismo commit.

**Reorganizado 2026-09-02** (pedido literal: "hoy engaña a cualquier sesión
nueva que lo lea primero, incluida yo hoy hasta que verifiqué contra el
código"). Este documento nació el 2026-08-27 como la VISIÓN completa del
proyecto entero — recursos, EXP, crafteo, inventario, equipo, vivienda,
economía, combate, Twitch, todo en un solo archivo, antes de que existiera
una sola línea de la mayoría. Desde entonces cada sistema se implementó de
verdad y ganó su propio GDD dedicado, más detallado y más al día que la
"visión" original — pero el texto se quedó aquí sin podar. Se ha recortado
duro: las subsecciones de §5 que NADIE cita desde código (verificado con
`grep -r "GDD_Mecanicas.md §"` sobre todo el repo antes de tocar nada) se
redujeron a un puntero de una línea al doc dedicado; las que SÍ son la
fuente citada de verdad en decenas de sitios (§5.4 vida/ataque/defensa,
§5.11 roles de Twitch, §5.12 comida/descanso+chat) se quedaron con su
contenido real, solo recortadas de narrativa histórica. Si buscas el
DISEÑO completo de un sistema ya construido, el doc dedicado manda; si
buscas si algo está hecho o no, o el número exacto que otro archivo cita
como "§5.4", mira aquí.

## 0. Principios

- **El servidor es la autoridad.** El cliente solo envía intención (dirección,
  bucear) y dibuja lo que el servidor dicta. Nada de física en cliente.
- **Unidades: casillas.** 1 casilla del mapa bakeado = 1 unidad de mundo del
  cliente. Las posiciones son floats en casillas; las velocidades,
  casillas/segundo.
- **El catálogo manda.** Qué bloquea y qué se nada NO está escrito en el
  código del servidor: sale de `baker/catalogo/terrenos.json`
  (`transitable`, `requiereNadar`, `modVelocidad`) y del campo `colision`
  de `vegetacion/rocas/animales.json`. El servidor construye su rejilla de
  colisión UNA vez al crear la room (`server/src/mundo/mapaColision.ts`).
- **Toda mecánica nace servidor-autoritativa y sincronizada**: el cliente
  solo envía intención y pinta lo que el servidor dicta. Nada de estado de
  juego decidido en cliente, nunca — regla transversal a TODO el proyecto,
  no solo a lo de este documento.

## 1. Colisiones (vigente)

Caja SENCILLA e igual para todo, por decisión de diseño (nada de hitboxes
por forma):

| Cosa | Caja | Regla |
|---|---|---|
| PJ/NPC/animal | AABB de radio 0.35 casillas (derivado del catálogo para fauna/NPCs: `personajes/catalogo/animales_rig.json` — nunca a mano ni por malla/vóxel) | choca con sólidos; con otros PJ se EMPUJA, no se bloquea |
| Terreno `transitable: false` sin `requiereNadar` (roca_inaccesible, lava…) | su casilla entera | pared |
| Pieza de catálogo con `colision: true` (árboles con madera, rocas/vetas, animales grandes) | su casilla entera | pared; solo endurece casillas de tierra |
| Terreno con `requiereNadar` (agua, agua_profunda) | — | NO es pared: es un MEDIO (ver §2) |
| Borde del mapa / chunk ausente / fuera del mapa | — | pared |

- Movimiento eje a eje con "slide": chocar en X no anula el avance en Y.
  Al chocar, el PJ queda pegado al borde de la casilla (radio + ε).
- Subpasos de ≤ 0.25 casillas: ningún paso grande atraviesa una pared.
- PJ contra PJ: separación suave por pares, re-validada contra los sólidos
  — O(n²) con `maxClients` 40: barato a 30hz.
- Interiores (edificios/muebles/paredes): misma regla de casilla al cruzar
  puertas — ver `docs/GDD_Sistema_Puertas.md`.

## 2. Agua: nadar y bucear (vigente)

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
  del agua TRANSLÚCIDA descendiendo hacia el lecho (`client/src/render3d/terreno.ts`).
- **Aire/ahogo real** (`Vitales.aire`, `server/src/personaje/vitales.ts`):
  decae SOLO buceando de verdad (nivel<0), se rellena al instante al salir
  a respirar. 45s reales de aguante; agotado, `vida` cae ~1.5/seg mientras
  se siga buceando (`aplicarAhogo`, misma excepción deliberada a "nadie se
  hace daño solo con el tiempo" que `aplicarInanicion`, ver §5.4). Test: 8
  casos puros en `vitales.test.ts` — sin e2e dedicado todavía.
- **Fauna acuática solo agrea bajo el agua**: una especie `requiereAgua`
  (orca, tiburón...) exige `jugador.estado !== "tierra"` para agrearlo —
  de pie en tierra firme cerca de la orilla está fuera de su alcance,
  aunque caiga dentro de `radioAgro` por distancia recta.
- **Corrientes de agua: DESCARTADAS explícitamente** (no pospuestas,
  2026-09-02) — coste de diseño/implementación/test no justificado para un
  MMO social de stream; nadie lo ha pedido. Si el streamer lo pide
  explícitamente, se diseña entonces desde cero.

## 3. Recursos y recolección (✅ implementado)

El sistema descrito originalmente aquí (tags por especie, `golpes`/agotado,
respawn perezoso, herramienta obligatoria) está implementado tal cual se
diseñó: `server/src/mundo/recolectables.ts` (nodos vivos/agotados por mapa,
identidad = casilla, respawn perezoso por timestamp — nunca timers),
catálogo de materiales y tags en `baker/catalogo/{vegetacion,rocas,animales}.json`
+ `items/catalogo/items.json`. Sincronización barata: solo se replica el
diccionario de nodos TOCADOS, el resto se deduce del mapa bakeado que todos
tienen — mismo principio transversal de §0. Sin GDD dedicado propio (se
quedó aquí porque no ha hecho falta partirlo); si crece más, se le da su
propio documento como al resto.

## 4. Aparición

Al entrar a la room se aparece en la `ciudad` del índice del mapa,
corregida a la casilla de TIERRA pisable más cercana (búsqueda en anillos).

## 5. Sistemas RPG

Regla de oro repetida en todos: catálogo como fuente de verdad + servidor
autoritativo (§0). Subsecciones **5.4, 5.11 y 5.12** llevan contenido real
(decenas de citas desde código las tratan como fuente) — el resto son
punteros cortos a su doc dedicado, que manda sobre el diseño completo.

### 5.1 EXP y habilidades — ✅ implementado

Ver `docs/GDD_Personaje.md` (atributos/vitales) y `docs/GDD_Profesiones.md`
(oficios, curva de XP compartida en `server/src/progresion/nivel.ts`).

### 5.2 Crafteo — ✅ implementado

Ver `docs/GDD_Crafteo.md` (materiales por tier, refinamiento, recetas —
276 recetas reales a 2026-09-02).

### 5.3 Inventario — ✅ implementado

Ver `docs/GDD_Inventario.md` (rejilla tipo Tetris + peso, tal como se
diseñó aquí originalmente).

### 5.4 Vida, ataque, defensa y combate directo (✅ implementado, base citada por todo el proyecto)

Fuente de verdad de las stats de combate más básicas — decenas de
ficheros (`combate/`, `mundo/fauna*.ts`, `datos/bd.ts`, schemas, tests)
citan este número exacto de sección, así que se queda con contenido real
en vez de solo un puntero. El DISEÑO completo del combate táctico por
turnos vive en `docs/GDD_Combate.md`; esto es la base que ese sistema
reutiliza como fuente de HP.

- **Animales**: NUNCA tienen defensa — su única resistencia es la vida
  máxima. La vida máxima escala por `categoriaVida`
  (`baker/catalogo/animales.json`): cría ~8, pequeño 15-25, mediano 50-65,
  grande 100-200, alfa 300+ (tiburón/orca/araña gigante/calamar gigante —
  `colision + peligroso` a la vez).
- **Jugadores y NPCs humanoides**: SÍ tienen ataque y defensa. Todo
  jugador arranca con **100/100 HP** obligatorio. `Player.ataque/defensa`
  (Schema de red, base 3/0 a puño limpio) suben con equipo real
  (`recalcularStatsJugador`, ver `docs/GDD_Equipo.md`).
- **Fórmula de daño** (`server/src/combate/combate.ts`, módulo puro):
  `daño = max(1, ataque - defensa)` — nunca menos de 1. Un animal siempre
  recibe `defensa: 0`.
- **Regeneración/curación**: NADIE se cura solo con el tiempo — ni
  jugadores, ni animales, ni NPCs. Solo comiendo (fuera de combate),
  pociones/magia, o curación explícita de otro jugador. `combate.ts` no
  tiene ninguna función de "tick" de vida — `curar()` es siempre un evento
  explícito. Excepciones deliberadas y explícitas a esta regla (dañan solo
  con el tiempo, pedidas por el streamer): inanición (`aplicarInanicion`,
  comida o bebida a 0) y ahogo buceando sin aire (`aplicarAhogo`, ver §2).
- **Catálogo de armas** (`items/catalogo/items.json`, `tipo:"arma"`):
  cuerpo a cuerpo (alcance 1-3: daga/espada_corta/espada_larga/
  hacha_combate/maza_guerra/lanza) y a distancia (alcance 4-9, más lentas:
  honda/arco_corto/arco_largo/ballesta, cada una con `municionId`). Munición
  (`tipo:"municion"`: piedra_honda/flecha/virote_ballesta) — **✅ cerrado
  del todo 2026-09-02**: recetas de crafteo reales para las 3, el `alcance`
  real del arma entra en juego en el combate táctico (antes SIEMPRE 1,
  cuerpo a cuerpo, sin importar el arma) y disparar consume una unidad de
  verdad (rechazo sin munición, mismo criterio que "fuera de alcance") —
  detalle completo de cómo se hizo compatible con el combate instanciado
  en arena aparte en `docs/GDD_Combate.md` §8. Sin armaduras todavía (solo
  había armas en esta pasada, pedido explícito del streamer en su momento).
- **`combate:atacar` (daño directo simple, sin turnos) es el sistema
  INTERINO** — sigue funcionando sin tocar, pero `docs/GDD_Combate.md`
  (combate táctico por turnos en rejilla) es el sistema DEFINITIVO desde
  el 2026-08-30. Excepción: cuando NINGÚN combatiente es jugador (NPC vs
  animal, NPC vs NPC) el definitivo tampoco usa turnos — se autosimula de
  golpe (`docs/GDD_Combate.md` §7). Los campos de vida (`Player.vida/
  vidaMax`, `Fauna.vida/vidaMax/ataque`, persistencia en BD, cadáveres) los
  reutiliza el táctico tal cual, no inventa unos nuevos.

### 5.5 Objetos por el suelo — ✅ implementado

Ver `docs/GDD_Inventario.md`.

### 5.6 NPCs con IA conversacional — ✅ implementado

Ver `docs/GDD_IA_NPCs.md` (Gemini + Groq de respaldo, memoria por
NPC+jugador con RAG). Pendiente real: el contexto de mundo sigue siendo
placeholder genérico, no la biografía individual que ya genera
`poblacion/generarHistoria.js` — cablear eso, ver ese doc.

### 5.7 Persistencia — ✅ implementado

`server/src/datos/bd.ts`: `IAlmacenDatos` con SQLite local (dev/tests) y
Postgres/Neon (producción), elegido por `DATABASE_URL`. Desplegado en
`colony-server` (Render, Frankfurt, free) — estado de despliegue real
siempre en `CLAUDE.md`, no aquí (cambia con más frecuencia que este doc).

### 5.8 Vivienda / construcción — ✅ implementado

Ver `docs/GDD_Construccion.md` (el contrato — leer ANTES de tocar nada de
construcción/parcelas/propiedad) y `docs/GDD_Propiedades.md`.

### 5.9 Economía, moneda y tiendas — ✅ implementado

Ver `docs/GDD_Economia.md`, `docs/GDD_Comercio.md`, `docs/GDD_Mercado.md`.

### 5.9bis Fauna/NPCs como entidades vivas, monturas — ✅ implementado

Ver `docs/GDD_Agentes_Moviles.md` (movimiento/IA), `docs/GDD_Poblacion_NPCs.md`
(censo/rutinas) y `docs/GDD_Monturas.md`.

### 5.10 Combate PvE/PvP y muerte — ✅ implementado

Ver `docs/GDD_Combate.md` (táctico por turnos), `docs/GDD_PvP.md` (zonas
seguras vs PvP activado), `docs/GDD_Caza.md`, y `docs/GDD_Muerte_Respawn.md`
(objetos sueltos al suelo, equipo con -20% durabilidad flat, respawn en
cama propia o Hub, cadáver looteable). Las stats base (vida/ataque/
defensa) viven en §5.4 de este documento.

### 5.11 Twitch: jerarquía, títulos y viewers (✅ implementado — citado por `docs/GDD_Twitch.md` §2)

- Los ROLES del chat de Twitch (mod, VIP, sub, viewer) se traducen en
  TÍTULOS visibles sobre el PJ y en la jerarquía social del pueblo del
  streamer. Perks COSMÉTICOS y sociales (título, color de nombre, acceso a
  zonas sociales), NUNCA ventaja de poder — el poder se gana jugando.
- La vinculación cuenta-Twitch ↔ PJ es parte de la identidad persistente
  (§5.7). Los títulos se refrescan al conectar (rol actual del canal).
- Viewers desde el chat: comandos que influyen en el mundo (eventos,
  regalos, votar) — cada comando es un mensaje más al servidor
  autoritativo, con presupuesto/rate-limit por viewer.
- El STREAMER es el administrador: comandos GM (teleport, spawn de evento,
  kick/ban) reservados a su cuenta — ver `docs/GDD_Admin.md` para el
  diseño completo de sesiones admin/jarl.

Diseño completo (jerarquía exacta, refresco de rol, UI de títulos):
`docs/GDD_Twitch.md`.

### 5.12 Comida/descanso, chat, y lo que queda de verdad por hacer

- ✅ **Comida y descanso** (2026-09-02, tono delegado por el streamer,
  decidido: buffs de comer/dormir, NUNCA muerte por hambre —
  `aplicarInanicion`, §5.4, sin tocar). Reusa `BuffPocion`/
  `buffsPocionPorSesion` de `docs/GDD_Pociones.md` tal cual (mismo Map,
  mismas `aplicarBuffsPocion`/`factorBuffPocion`/`tieneEspecialActivo`)
  — comer/dormir son otra FUENTE de los mismos buffs, no un mecanismo
  aparte: "**Bien alimentado**" (`personaje:consumir` con `comida`/
  `bebida` restaurada, ítem crudo o plato de `docs/GDD_Cocina.md`) da
  +8% de velocidad 5 min; "**Descansado**" (`dormir:completar`, además de
  rellenar Estamina al máximo como ya hacía) da doble XP de oficio 20 min.
  Sin cap de apilado, mismo criterio que las pociones. Test: cubierto por
  la batería de `alquimia.test.ts` sobre las mismas funciones — sin e2e
  dedicado de "comer/dormir sube la velocidad/XP de verdad en una room
  real" todavía (gap conocido).
- ✅ **Chat local/global entre jugadores** (2026-09-02, pedido literal:
  "literalmente no existe ningún canal local/global para que dos
  jugadores se hablen... esto importante" — confirmado por auditoría: el
  único "hablar" que existía era `npc:hablar`, con IA, nunca entre
  jugadores). `chat:mensaje {texto, canal:"local"|"global"}`
  (`RoomExteriorBase.ts::manejarChatMensaje`, heredado por TODAS las
  rooms): "global" = `this.broadcast` a TODA la room actual (una
  instancia con tope de jugadores, no el mapa entero — cruzar varias
  instancias a la vez exigiría un canal nuevo que hoy no existe, fuera de
  esta pasada); "local" = solo a quien esté dentro de
  `RADIO_CHAT_LOCAL=20` casillas (recorre `this.clients`, `client.send`
  individual, incluye a quien habla). Server-authoritative (`nombre`
  siempre de `player.name`), rate-limit 600ms, tope 200 caracteres, sin
  moderación de contenido. Cliente: `client/src/ui/chat.ts` (`PanelChat`,
  DOM plano estilo `panelCombate.ts`), panel persistente esquina inferior
  izquierda, Enter abre/envía. **Bug real cerrado al construirlo**: el
  keydown global de `game.ts` no comprobaba si un `<input>` tenía el foco
  — escribir un mensaje con letras de atajos (b/i/m/d...) disparaba A LA
  VEZ esos atajos de juego, incluido MOVERSE si el mensaje llevaba WASD;
  corregido con un guardia (`document.activeElement instanceof
  HTMLInputElement/HTMLTextAreaElement` → return) que protege también a
  cualquier otro panel con `<input>`. Test: `client/test/chat.e2e.mjs`
  (protocolo, dos sesiones reales) + `client/test/chatUI.e2e.mjs`
  (navegador real vía Playwright — la regresión del guardia, verificada
  de verdad, no solo corregida de memoria).
- ✅ **Zonas e instancias, fauna móvil, ciclo día/noche**: resueltos,
  repartidos entre `docs/GDD_PvP.md` (seguro/PvP), `docs/GDD_Construccion.md`
  (permisos por parcela), `docs/GDD_Agentes_Moviles.md` (fauna/NPC móviles)
  y `docs/GDD_Tiempo_Mundo.md`/`docs/GDD_Clima.md` (reloj de mundo
  perezoso). Nunca se escribieron como un reglamento único "qué puede
  pasar en cada tipo de zona" — funciona, pero es documentación pendiente
  de algo que ya existe, no una mecánica que falte.
- ✅ **Administración y anti-abuso**: `docs/GDD_Admin.md` (comandos GM,
  sesiones admin/jarl, rate-limit).
- ⬜ **Misiones/encargos** — cero código todavía. NPCs piden "N objetos de
  tag X" (los tags ya existen en todo el catálogo, sería genérico y
  barato de montar); recompensa moneda/EXP/blueprints.
- ⬜ **Eventos de mundo** — cero código todavía. Invasiones, ferias,
  apariciones raras, disparados por el streamer o por hitos de viewers,
  sobre el esqueleto de zonas + spawns que ya existe.
- ⬜ **Emotes del rig y grupos (party) para PvE** — cero código todavía.
  Reparto de botín en grupo, emotes de animación. Los gremios
  (banco+inventario compartido, `docs/GDD_Gremios.md`) YA existen y NO
  son lo mismo que un grupo de caza temporal.

## 6. Cómo se prueba

- `cd server && npm test` — suite completa `tsx --test test/*.test.ts`
  (1172 tests a 2026-09-02: lógica pura de todos los sistemas del §5, no
  solo colisiones — cada doc dedicado lista los suyos).
- E2E reales (servidor Colyseus real + colyseus.js/Playwright,
  `client/test/*.e2e.mjs`/`*.e2e.cjs`, ~25 archivos a 2026-09-02) — fuera
  de `npm test`, se corren a mano. Patrones a copiar según lo que se
  prueba:
  - `client/test/mecanicas.e2e.mjs` — las reglas de ESTE documento
    (colisión, agua/buceo) contra el mapa demo, leyendo la verdad del
    servidor vía `window.__colonyDebug`.
  - `client/test/concurrencia.e2e.mjs` — dos sesiones `colyseus.js`
    mandando el MISMO mensaje sobre el MISMO recurso a la vez
    (`Promise.all`), muchas rondas seguidas: el patrón para cualquier
    mensaje nuevo que lea-luego-escriba estado compartido (Colyseus no
    serializa `onMessage` async entre sí, ver `GDD_Construccion.md` §5bis
    y la regla de concurrencia en `CLAUDE.md`).
  - `client/test/chatUI.e2e.mjs` — el patrón para probar una UI nueva de
    verdad en un navegador (Playwright), no solo el protocolo de servidor.
