# Reloj de mundo y ciclo día/noche — decisión y estado (v1)

## Decisión (confirmada con el streamer, 2026-08-28)

Hay UNA hora de juego canónica para todo el mundo, y se **deriva del reloj
real** en vez de simularse: `hora = f(Date.now())` con una época fija y una
escala, ambas en `assets/mundo/tiempo.json` (única fuente — nadie más
define duraciones). Consecuencias buscadas:

- **Cero red y cero estado**: el servidor y todos los clientes calculan la
  misma hora en el mismo instante sin sincronizar nada. No hay tick de
  reloj, no hay mensaje "son las 14:00", no hay trabajo de fondo — encaja
  con la regla de Render free (nada de polling).
- **La autoridad sigue siendo del servidor**: la copia del cliente solo
  ilumina; cualquier efecto de juego (rutinas de NPC, respawn, estaciones)
  consulta la copia del servidor. Un jugador con el reloj desajustado ve
  el atardecer unos segundos antes — y nada más.
- **Cálculo perezoso listo**: cualquier sistema futuro "X pasa con el
  tiempo" (crecimiento de bosques, respawn de recursos, backlog) se
  resuelve restando timestamps con esta misma fórmula, sin timers vivos.

## Calendario (heredado de GDD_Bakeador_Exteriores §8.1, ahora formalizado)

- 1 día de juego = **30 min reales** (día de 24 h de juego).
- Amanecer 04:00, anochecer 20:00 → **16 h de sol + 8 de noche**
  (= 20 min reales de día + 10 de noche).
- 1 estación = 7 días de juego; año de 4 estaciones (~14 h reales).
- Época del mundo: 2026-01-01T00:00Z (día 0). Todo configurable en el
  JSON: cambiar `minutosRealesPorDia` acelera el mundo entero.

## Estructura

- `assets/mundo/tiempo.json` — las constantes (única fuente).
- `server/src/mundo/tiempoMundo.ts` y `client/src/mundo/tiempoMundo.ts` —
  la misma fórmula a ambos lados (día, hora fraccional, estación, año,
  esDeDia). El cliente admite `?hora=19.5` en la URL para forzar la hora
  (solo iluminación, para depurar/capturas; el servidor la ignora).
- `client/src/render3d/cicloDia.ts` — hora → estado visual, matemática
  pura sin escena (testeable a mano): el sol sale por el este, recorre un
  arco y se pone por el oeste; amanecer/atardecer cálidos, mediodía
  neutro; la elevación no baja de ~14º con sol fuera (la caja de sombras
  de la ortográfica se degrada más abajo). La noche NO es negra: luna
  direccional fría y tenue con el mismo arco, ambiente bajo y cielo azul
  oscuro — se juega de noche, solo que se nota.
- `WorldScene.actualizar()` aplica el estado cada frame (asignaciones de
  números: coste despreciable) — las sombras giran solas porque el astro
  se mueve de verdad alrededor del objetivo de cámara.

## Verificado (v1)

Capturas Playwright del mismo punto del mapa a 4 horas forzadas
(`?hora=6|13|19|1`): sol bajo cálido con sombras largas al amanecer, luz
neutra alta al mediodía, atardecer naranja desde el oeste con sombras
opuestas al amanecer, y noche azulada tenue pero legible. tsc limpio,
suites E2E de cliente en verde.

## Qué falta (pendiente, no bloquea)

- **Luces urbanas**: consumir el canal `indice.luces` de ciudades/
  (farolas/antorchas) encendiéndolas entre anochecer y amanecer.
- **Estaciones visibles**: la estación ya se calcula pero no cambia nada
  aún (tinte de vegetación/nieve son arte futuro).
- **Interiores**: la iluminación interior es independiente del sol
  (aporte de luz por mueble, GDD_Bakeador_Interiores §7bis) — decidir si
  las ventanas dejan entrar la hora.
- HUD con la hora en pantalla (cuando exista HUD).
