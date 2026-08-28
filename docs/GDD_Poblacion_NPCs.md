# Poblador de NPCs — decisión y estado (Fase 1)

Cómo un asentamiento (aldea/pueblo/ciudad/castillo de `ciudades/`, o un POI) se puebla de NPCs reales: censo, identidad, familia, vestido, vivienda, trabajo y rutina. Léelo antes de tocar `poblacion/`.

## Decisión (confirmada con el streamer, 2026-08-28): por fases

El pipeline completo es grande, así que se construye y se prueba en 3 fases, cada una jugable/verificable antes de montar la siguiente:

1. **Fase 1 (esta, HECHA)**: censo (quién hace falta) → identidad (nombre/apellido) → familia (cónyuge + 0-2 hijos) → vestir (reusa `personajes/` + `ropa/`) → biografía individual (IA offline, una vez). Sin ubicar en el mapa ni asignar vivienda/trabajo todavía.
2. **Fase 2 (pendiente)**: vivienda (casa+cama dentro del bake de interiores del asentamiento) y trabajo (edificio de su oficio más cercano).
3. **Fase 3 (pendiente)**: perfiles sociales (trabajador, sociable, granjero, "aparenta trabajar"...) → rutina horaria por perfil → caminos bakeados entre casa/trabajo/taberna → runtime en el servidor (FSM barata: qué tramo de rutina toca según la hora, seguir el camino precalculado, animación idle/acción al llegar). Nada de esto corre IA en directo — la IA solo se usó offline en Fase 1 para la biografía, y en directo solo cuando un JUGADOR le habla al NPC (`server/src/ia/`, ver GDD_IA_NPCs.md).

Los animales/bichos con esqueleto (ya generables por `personajes/generarAnimal.js`) se pueblan con el mismo patrón de spawn+paths de la Fase 3 pero sin rutina social — deambulan sin más. Se aborda junto a la Fase 3, no antes.

## Fase 1 — estructura

- `poblacion/catalogo/nombres.json` — nombres masculinos/femeninos/apellidos, ponderados, registro nórdico/medieval (una sola "cultura" por ahora).
- `poblacion/catalogo/censo.json` — por tier de asentamiento (MISMOS ids que `ciudades/catalogo/asentamientos.json`): qué NPCs de `personajes/catalogo/npcs.json` y cuántos, con `familia`/`probFamilia` opcional. **Placeholder**: solo cruza los 4 arquetipos de prueba que existen hoy; se amplía sin tocar código cuando el streamer pacte la lista definitiva de oficios.
- `poblacion/src/generarCenso.js` — por tier+semilla, decide los "slots" a generar: individuos sueltos y unidades familiares (cabeza + cónyuge + 0-2 hijos). Determinista.
- `poblacion/src/generarIdentidad.js` — nombre+apellido por slot; el apellido se comparte dentro de la familia (simplificación v1: no distingue patronímico/matronímico pese al catálogo nórdico).
- `poblacion/src/generarHistoria.js` — UNA llamada a Gemini por NPC (nunca en directo) que devuelve `{ personalidad, conocimiento[] }` propios del individuo — ve el contexto del mundo, su nombre/oficio/familia, y pide JSON estructurado (`responseMimeType: "application/json"`). Sin `GEMINI_API_KEY`, o si falla, devuelve `null` sin tumbar el pipeline (el NPC se queda con la personalidad/conocimiento genéricos de su arquetipo en `npcs.json`). **Esto resuelve el pendiente anotado en GDD_IA_NPCs.md**: cada NPC individual ya puede tener su propia vida, no solo la de su arquetipo — cuando `server/src/ia/npcChat.ts` hable con un NPC del mundo real, debe preferir la biografía individual de `poblacion/` si existe, y solo caer al genérico de `npcs.json` si no la hay (cableado pendiente, ver "Qué falta").
- `poblacion/src/exportarPoblacion.js` — orquesta todo. CLI: `node poblacion/src/exportarPoblacion.js <tier> <semilla> [salida.json]`. Sin `salida.json` explícito escribe en `poblacion/output/` (gitignored, como el resto de módulos).
- **Cambio pequeño en `personajes/src/generarPersonaje.js`**: acepta `opciones.sexoForzado` (para el cónyuge, sexo opuesto al cabeza) y `opciones.factorEscala` (para los hijos, cuerpo más pequeño). Sin pasarlos, comportamiento IDÉNTICO al de antes — no afecta a `personajes/exportar_demo.js` ni a nadie más.

## Verificado (Fase 1)

- `poblacion/test/poblacion.test.js` (7 tests): censo determinista en los 6 tiers, toda familia tiene exactamente 1 cabeza + 1 cónyuge (+0-2 hijos), export de punta a punta determinista, cónyuge de sexo opuesto al cabeza con el mismo apellido en toda la familia, hijos con altura media menor que los adultos, cada NPC sale vestido con vóxeles reales.
- Prueba manual (`node poblacion/src/exportarPoblacion.js aldea semilla-demo-1`): 17 NPCs coherentes (3 familias con apellido compartido + sueltos + herrero + guardias).
- Suites no tocadas siguen en verde tras el cambio en `generarPersonaje.js`: `interiores/test/catalogo.test.js`, `ciudades/test/ciudad.test.js`, `personajes/src/exportar_demo.js` (regenera igual que antes).
- **No verificado con la API real de Gemini** (biografías): igual que en GDD_IA_NPCs.md, este entorno de desarrollo no tiene salida de red a `generativelanguage.googleapis.com`. `generarHistoria` está probado por estructura (JSON esperado, manejo de fallo) pero no se ha visto una biografía real generada — probarlo con `GEMINI_API_KEY` puesta en un entorno con red.

## Qué falta (pendiente, no bloquea)

- **Cablear la biografía individual en el diálogo en directo**: `server/src/ia/npcChat.ts` hoy solo lee `personalidad`/`conocimiento` de `personajes/catalogo/npcs.json` (por arquetipo). Cuando el servidor puebla un asentamiento con el JSON de `poblacion/`, `GestorConversacionesNpc` debe preferir la biografía individual del NPC si existe.
- **Fase 2**: vivienda (necesita que el bake de interiores de `ciudades/` exponga qué habitación de qué casa es dormitorio) y trabajo (edificio más cercano de su oficio, con capacidad — una herrería no admite 10 herreros).
- **Fase 3**: catálogo de perfiles sociales + rutinas horarias + caminos bakeados (reusar el A* del bakeador exterior a escala de asentamiento) + el runtime barato en el servidor que mueve al NPC por su camino según la hora del juego.
- **Nombres de localizaciones**: de momento todo usa el id interno del asentamiento (decisión tomada con el streamer); nombrar aldeas/POIs de forma bonita se pacta más adelante, sin bloquear nada de esto.
- **Arquetipos civiles propios** (ama de casa, aprendiz...): hoy cónyuge e hijos se generan como "aldeano" genérico — simplificación v1. Si hace falta más variedad, se amplía `personajes/catalogo/npcs.json`, no el generador.
