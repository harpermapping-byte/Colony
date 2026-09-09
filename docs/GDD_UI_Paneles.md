# GDD — Framework de paneles/menús + dock de iconos (HUD limpio)

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-09-09), MIGRACIÓN PARCIAL.** Piezas: `client/src/ui/temaPaneles.css`, `client/src/ui/panelBase.ts` (`crearMarcoPanel` + helpers de contenido), `client/src/ui/dockHud.ts`. Migrados a este marco: `personaje/panelJugador.ts`, `mapa/panelMapaMundo.ts`, `personaje/panelResumen.ts` (los 3 registrados en el dock desde `game.ts`). El resto de los ~30 paneles del proyecto (ver inventario en el punto 5) sigue con su chrome manual de siempre — funcionan igual que antes, simplemente no están en el dock todavía. Probado: `tsc --noEmit` limpio en cliente, 37/37 tests unitarios sin regresión, y verificación visual con Playwright real (dock con 3 iconos, clic abre/cierra cada panel, la X cierra, clic fuera cierra, la tecla de siempre (I/M/Tab) sigue funcionando Y el dock refleja el estado).

## 0. Pedido y decisiones (2026-09-09)

Pedido del streamer: *"necesito crear placeholder sencillos de todos los menús y pantallas de mi juego, todas se deben poder minimizar o abrir dejando una HUD limpia con algun emoticono (que abre esa pestaña o con teclado)... antes de hacer nada quiero plantear como hacerlo para luego solo retocar esteticamente"*. Planteado y discutido antes de tocar código (regla CLAUDE.md). Añadido en la misma conversación: *"todas deben tener una X en la parte superior derecha para cerrarlas... también dando click fuera se debería cerrar"*.

Diagnóstico previo (research del código real, no supuesto): ~30 paneles ya existían, TODOS con su propio boilerplate manual repetido (mismo `rgba(20,16,10,0.88)`, mismo borde, mismo `innerHTML=""` a mano), sin clase base ni CSS compartido. Ya no quedaba ninguna letra de teclado libre (A-Z asignadas a verbos de juego o a paneles existentes). Decisión confirmada: paneles NUEVOS se abren solo desde el dock (sin gastar tecla nueva); los paneles YA existentes con tecla la conservan tal cual, y ADEMÁS ganan icono en el dock.

## 1. Separar ESTRUCTURA de ESTÉTICA — el porqué del diseño

Para que "retocar estéticamente al final" (placeholder tosco ahora, arte real después — mismo criterio ya aplicado a texturas/muebles/personajes en todo el proyecto) sea editar un archivo, no ~30:

- **`temaPaneles.css`**: variables CSS (`--panel-bg`, `--panel-borde`, `--panel-texto`...) — la paleta de hoy es literalmente la misma pergamino-oscuro que ya usaban `panelJugador.ts`/`panelCombate.ts` a mano, solo centralizada.
- **`panelBase.ts::crearMarcoPanel`**: por COMPOSICIÓN, no herencia. Devuelve `{raiz, cuerpo, abrir, cerrar, alternar, estaAbierto, onCambioEstado}` — un panel (nuevo o existente) lo llama UNA vez y monta su contenido en `cuerpo`. Se descartó una clase base abstracta con método de render obligatorio: varios paneles reales (`panelJugador.ts`) reciben su contenido por PUSH externo (`actualizar(player)` en cada tick de red), no lo generan solos — forzar una jerarquía de herencia habría exigido reescribir esa lógica ya probada sin ganar nada real.
- **`dockHud.ts`**: franja fija de iconos. No conoce el contenido de ningún panel — solo llama `alternar()`/`estaAbierto()` sobre lo que `registrar(id, panel, {icono,titulo})` le pase. Cualquier objeto con esa forma sirve (duck typing), incluidos paneles viejos adaptados sin tocarlos por dentro.

## 2. Cierre: X + clic fuera + Escape, sin el bug de "abre y cierra en el mismo gesto"

Los tres disparados por `crearMarcoPanel`. El riesgo real identificado ANTES de escribir código: un clic en el icono del dock ocurre FUERA de `raiz` del panel — si el cierre genérico por "clic fuera" (usa `mousedown`, dispara antes que el `click` del icono) también reaccionara a ese mismo clic, un panel abierto se cerraría (por el mousedown-fuera) y se reabriría de inmediato (por el `alternar()` del propio icono) en el mismo gesto — el mismo tipo de bug que el proyecto ya había resuelto una vez para `menuInteraccion.ts`/`game.ts` (2026-09-06). Solución: el cierre genérico ignora explícitamente cualquier clic dentro de `.dock-hud-icono` — cada icono gestiona el toggle de SU panel sin interferencia.

## 3. Migración de los paneles ya existentes: por adaptación, no reescritura

Los 3 paneles migrados (`panelJugador.ts`, `panelMapaMundo.ts`, `panelResumen.ts`) recibieron el MÍNIMO cambio necesario, sin tocar su lógica de datos ni su layout ya probado:

- **`panelJugador.ts`** (panel flotante pequeño, sin fondo fullscreen): ganó un botón `.panel-colony-cerrar` posicionado absoluto en su propia esquina, un listener de `mousedown`-fuera (mismo criterio que arriba), Escape, y `onCambioEstado`/`estaAbierto()` para el dock.
- **`panelMapaMundo.ts`/`panelResumen.ts`** (overlays fullscreen con fondo oscuro): YA cerraban con clic en el fondo y con Escape desde su creación — solo ganaron el botón X visible (antes el cierre por clic-fuera existía pero sin ningún affordance visual) y `estaAbierto()`/`onCambioEstado()`.

**Hallazgo real corregido durante la migración**: registrar `panelJugador` tal cual en el dock dejaba el panel en blanco al abrirlo por icono — la tecla `I` YA hacía `panelJugador.alternar(); if (estaVisible()) actualizar(player)` (fuerza un render inmediato, porque `alternar()` por sí solo no reconstruye el DOM, solo cambia el estilo `display`), pero el dock solo llamaba a `alternar()`. Corregido registrando un ADAPTADOR en `game.ts` (no el panel directo) que replica el mismo `alternar()+actualizar()` que ya usaba la tecla — sin este fix, un jugador real que descubriera el panel por el icono (en vez de por la tecla) lo habría visto vacío hasta el siguiente cambio de red.

## 4. Riesgo evaluado y descartado: mostrar la bienvenida no debía tocar el dock

`pantallaBienvenida.ts` (ver `docs/GDD_Cuentas.md` §5) usa el MISMO `crearMarcoPanel` pero no se registra en el dock — es una pantalla de entrada de una sola vez (arranque), no un menú in-game persistente.

## 5. Inventario de paneles SIN migrar todavía (pendiente real, no ambigüedad)

Confirmado por inspección: `panelCofre.ts`, `panelCombate.ts`, `registroCombate.ts`, `panelDialogoNpc.ts`, `menuInteraccion.ts`, `modalInstrumento.ts`, `chat.ts`, `constructor.ts`, `colocadorPlantillas.ts`, `panelForja.ts`, `panelSastreLegendario.ts`, `panelCarpinteroLegendario.ts`, `panelIngenieroLegendario.ts`, `panelMascotas.ts`, `panelComercio.ts`, `panelReclutador.ts`, `panelTenderete.ts`, `panelLibro.ts`, `panelPesca.ts`, `panelCultivo.ts`, `panelInjerto.ts`, `panelCocina.ts`, `panelMedico.ts`, `panelCompanero.ts`, `panelAjedrez.ts`, `panelLoginAdmin.ts`, `panelJarl.ts`, `panelDebugTestZone.ts`, `panelContenedorTest.ts`. Ninguno se tocó en esta pasada — siguen funcionando exactamente igual que antes (ni mejor ni peor). Migrarlos al dock (X + registro) es trabajo mecánico repetible con el patrón del punto 3, sin decisiones de diseño nuevas — candidato natural para una pasada dedicada posterior, empezando por los que se abren con tecla dedicada (mismo criterio que esta pasada) antes que los contextuales/automáticos.

Placeholders que ni siquiera existían y siguen sin existir (confirmados por inspección, gremios/crafteo genérico/pociones/atributos/gestión de oficios/HUD de vitales-clima-hora — ver la pregunta original al streamer para el detalle completo): fuera de alcance de esta pasada, que priorizó explícitamente "menú principal + login + creación de personaje" (ver `docs/GDD_Cuentas.md`).
