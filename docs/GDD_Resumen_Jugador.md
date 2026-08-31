# GDD — Panel "todo lo que tienes"

Pedido literal del streamer (2026-08-31, dentro del mismo mensaje que mapa/plantillas/producción): *"monturas, animales, propiedades y NPC que tenga un jugador le saldrán en una pestaña que se abre en algún menú que pondremos más adelante, ahora la ponemos en cualquier tecla y se cambiará — es como un menú donde se ve que tienes y dónde y cómo está."*

## 0. Decisión de alcance

**Dos de las tres piezas YA existían, dispersas en paneles propios** — este pedido no es "construir desde cero", es "agregarlas en un sitio":

- **Monturas** (`docs/GDD_Mascotas.md`/`GDD_Monturas.md`): protocolo `mascota:listar` → `mascota:lista` YA existe, consumido hoy por `PanelMascotas` (siempre visible, esquina superior derecha). Este panel nuevo se apunta al MISMO mensaje — sin ronda nueva al servidor.
- **Compañero** (`docs/GDD_Companeros.md`): vive en `room.state.companeros` (Colyseus, tiempo real), ya espejado por `game.ts` hacia `PanelCompanero` (siempre visible). Este panel nuevo se apunta al MISMO callback (`actualizarPanelCompanero`) — tampoco pide nada nuevo.
- **Propiedades**: la única pieza que NO existía en ningún sitio — ni un mensaje de protocolo, ni un panel, ni siquiera una consulta de BD que filtrase por dueño (`cargarPropiedades()` siempre trajo la tabla `propiedades` ENTERA, pensado para que el servidor la cachee en memoria de room, nunca para "dame las de fulano"). Esta es la parte realmente nueva.

**No se retiran los paneles existentes** (`PanelMascotas`, `PanelCompanero`) — siguen para sus acciones propias (dar de comer, poner silla, reclutar, equipar). El panel nuevo es un resumen de solo lectura, "a vista de pájaro", pensado para el "menú de pestañas" que el propio streamer dice que llegará más adelante — cuando exista, esto se traslada ahí sin rediseñar nada, es una fuente de datos ya lista.

## 1. Servidor — lo único nuevo: propiedades por jugador

- `IAlmacenDatos.listarPropiedadesDeJugador(nombre): Promise<Array<Propiedad & {id: string}>>` (`server/src/datos/bd.ts`, SQLite + Postgres) — mismo `filaAPropiedad` que ya usaba `cargarPropiedades()`, pero con `WHERE j.nombre = ?` en vez de traer la tabla entera y filtrar en memoria. Nombre EXACTO (mismo criterio de identidad v1 que `obtenerOCrearJugador`, sin `COLLATE NOCASE`). Cubre cualquier `tipo` (`parcela`/`inmueble`/`habitacion`/`plantilla`) — es la misma tabla `propiedades` que ya usa TODO lo que tiene dueño en el juego, plantillas del jarl incluidas (`docs/GDD_Produccion.md`).
- `RoomExteriorBase.ts`: `propiedad:listarMias` → `manejarPropiedadListarMias` → `propiedad:misPropiedades { id, tipo, asentamiento, modoTenencia, precioFarycoins, expiraEn, impuestoActivo, impuestoFarycoins, impuestoPeriodoHoras }[]`. Snapshot bajo demanda, mismo criterio "sin push continuo" que `mapa:consultarExploracion` — el cliente pide fresco cada vez que abre el panel.
- Tests: `server/test/datos.test.ts` (+1, filtra correctamente por dueño exacto, ignora propiedades de otro jugador y sin dueño, vacío si el nombre no tiene ninguna).

## 2. Cliente — `client/src/personaje/panelResumen.ts`

Overlay a pantalla completa (mismo patrón visual que `panelMapaMundo.ts`: fondo oscuro + caja centrada, Escape cierra), tres secciones con encabezado propio:

1. **🐾 Monturas** — de `mascota:lista` (reenviado también a `PanelMascotas` en el mismo `room.onMessage`, cero duplicación de la petición). Especie + silla puesta o no + "te sigue" / "dejada en `<propiedadId>`".
2. **🏠 Propiedades** — de `propiedad:misPropiedades`, pedido fresco cada vez que se abre el panel (`mostrar()` → `consultarPropiedades()`). Tipo + id + asentamiento + cómo se tiene (asignada/comprada/alquilada, con fecha de expiración si aplica) + impuesto del jarl si está activo.
3. **🛡️ Compañero** — del mismo `c` (Schema) que ya alimenta a `PanelCompanero`, vía `actualizarPanelCompanero` en `game.ts` (una llamada más al lado de la que ya había). Nombre/nivel/vida + posición (x,y) + su burbuja de queja actual si tiene hambre (`quejaTexto`, docs/GDD_Companeros.md), como "cómo está".

**Tecla: Tab** (temporal, pedido explícito de "cualquier tecla" — las 26 letras del teclado ya estaban TODAS asignadas a otro sistema del juego, comprobado antes de elegir; Tab era la única libre. `preventDefault()` para que el navegador no se robe el foco). Se cambiará cuando exista el menú de pestañas real que el streamer menciona como destino final.

## 3. Verificado

- `npx tsc --noEmit` limpio en server y client.
- Suites completas: server 884/884 (antes 883, +1 nuevo).
- Playtest real (servidor+cliente+Playwright): Tab abre el panel con las tres secciones correctamente tituladas y en estado vacío resuelto (`Monturas (0)`, `Propiedades (0)` — no se queda en "cargando…", confirma que `propiedad:listarMias`/`propiedad:misPropiedades` completa el viaje ida y vuelta —, `Compañero` con su aviso de "sin compañero todavía"), sin errores de consola — captura conservada en la sesión. No se fabricó una propiedad propia para la captura (habría exigido saltarse el protocolo real con un mensaje crudo, evitado a propósito); la lectura correcta del filtrado por dueño ya queda demostrada con números por el test de BD nuevo (§1).

## 4. Huecos honestos que quedan

- **No hay animales de granja en el panel** — el pedido dice "monturas animales" (mascotas/monturas) y por separado hay animales de granja domesticados (`docs/GDD_Ganaderia.md`, `listarAnimalesGranjaMapa`) que hoy NO aparecen aquí; no está claro por el pedido si "animales" se refería a lo mismo que "monturas" (probable, mismo sustantivo repetido) o a los de granja también. Se dejó fuera por priorizar lo inequívoco (monturas+propiedades+compañero) — añadirlos es una sección más del mismo patrón si el streamer confirma que los quiere aquí.
- **Sin acciones desde este panel** — es puramente informativo; llamar a una mascota, reclutar compañero o pagar un impuesto pendiente se sigue haciendo desde los paneles propios de cada sistema. Encaja con "se ve que tienes" del pedido, que no menciona gestionar desde ahí.
- **Sin redibujado en vivo mientras está abierto** — monturas/compañero SÍ se actualizan solos (llegan por su canal ya-vivo aunque el panel esté abierto), pero propiedades es un snapshot fijo hasta cerrar y volver a abrir (mismo criterio ya aceptado en `panelMapaMundo.ts`).
- **Sin barcos** — el pedido no los mencionó explícitamente (a diferencia de "monturas animales propiedades y npc"); quedan fuera de v1, mismo criterio que animales de granja arriba.
