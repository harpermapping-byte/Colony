# GDD — Sistema de Gremios (clanes)

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-29).** Piezas: `gremios/catalogo/` (catálogos cerrados de emblemas y paleta de colores, patrón sibling-directory de `items/`/`interiores/`), `server/src/gremios/gremios.ts` (validación pura), `server/src/gremios/contextoGremios.ts` (caché en memoria por proceso), `server/src/datos/bd.ts` (persistencia: tablas `gremios`/`gremio_miembros`/`gremio_invitaciones`), `server/src/rooms/base/RoomExteriorBase.ts` (protocolo, disponible en CUALQUIER room que herede de la base — Hub, regiones, capital). Probado: `server/test/gremios.test.ts` (6/6, lógica pura), `server/test/datos.test.ts` (+8 tests de persistencia), suite completa 147/147, `npx tsc --noEmit` limpio, y E2E manual contra un servidor Colyseus real (fundar, nombre duplicado, invitar+aceptar en tiempo real, depositar/retirar, cambiar color/emblema, expulsar, disolver — 12/12 comprobaciones OK).

Pedido del streamer (2026-08-29, junto con mercado/propiedades/producción/motriz — ver `docs/Backlog_Mecanicas_Futuras.md` para el resto): *"el sistema de gremios, son como clanes bandas... habrá un npc con el que hables y te dará los papeles para crear tu banda y podrás poner nombre etc, tendrá banco común y pestaña de jugadores y podrá meter o expulsar jugadores como un clan de cualquier juego, también podrán determinar color y emblemas... ya veremos qué beneficios tienen los gremios."*

## 0. Decisiones de diseño

- **Farycoins = saldo numérico, no objeto de inventario.** Es la moneda del mundo (pedida también para tiendas/propiedades/producción); vive como columna `farycoins` en `jugadores` y se mueve con primitivas atómicas de BD (`ajustarFarycoins`/`ajustarBancoGremio`, ambas `UPDATE ... SET saldo = saldo + delta WHERE ... saldo+delta >= 0`, todo-o-nada sin necesitar transacción explícita). Infraestructura COMPARTIDA: el banco del gremio reusa el mismo patrón.
- **Catálogos cerrados, no generador de emblemas.** El streamer dejó elegir entre "generador de emblemas" o "catálogo cerrado"; se optó por catálogo cerrado (`gremios/catalogo/emblemas.json`, 15 entradas + `emblema_generico` por defecto) siguiendo la regla 7 del CLAUDE.md ("las listas crecen, el código no") — añadir un emblema nuevo es una entrada de catálogo, no tocar generación. Misma lógica para el color (`paletaColores.json`, 18 hex).
- **El NPC "papeles del gremio" NO está implementado en v1** — el protocolo (`gremio:fundar` etc.) es agnóstico de cómo se dispara; hoy se prueba mandando el mensaje directamente. Enganchar un NPC de la capital que abra el flujo es un pendiente de cliente/diálogo, no de servidor (§6).
- ~~"Ya veremos qué beneficios tienen"~~ — **resuelto (2026-08-30): "el beneficio de tener gremio es que se puede compartir un banco con el dinero y el inventariado de objetos y que se puede comprar terrenos más fácil al unir dineros"**. Ver §7bis: inventario compartido de objetos + comprar propiedad con el banco del gremio, sumados al banco de Farycoins que ya existía desde v1.
- **Sin oficiales/rangos intermedios en v1**: solo `lider` y `miembro`. `retirar` del banco solo lo puede hacer el líder (evita que cualquier miembro vacíe el banco común); `depositar` lo puede hacer cualquier miembro. Cambiar color/emblema/nombre: solo líder. Sin tope de miembros, sin transferencia de liderazgo (disolver es la única salida del líder).
- **Etiqueta pública vs. detalle privado**: el `Player` Schema replicado solo lleva `gremioId/gremioNombre/gremioColor/gremioEmblemaId` (para nametags/UI de todos los jugadores). El roster completo (nombres de miembros, saldo del banco) SOLO viaja por `client.send("gremio:estado", ...)` al propio interesado — nunca se broadcastea a quien no es miembro.

## 1. Catálogos (`gremios/catalogo/`)

- **`emblemas.json`**: mapa `id → {uso, colorDebug}`, cerrado, ampliable solo añadiendo entradas. `EMBLEMA_POR_DEFECTO = "emblema_generico"` (el que recibe un gremio recién fundado).
- **`paletaColores.json`**: `{colores: [...]}`, 18 hex. `colorPorDefecto()` devuelve siempre `colores[0]` — determinista, nunca azar (regla 3 del CLAUDE.md), aunque aquí no hay semilla de por medio: es simplemente "el primero de la lista", para que dos gremios fundados sin elegir color no diverjan por casualidad.
- Cargados y memoizados en `server/src/gremios/gremios.ts` (`cargarCatalogoEmblemas()`/`cargarPaletaColores()`), mismo patrón de caché module-level que el resto del proyecto.

## 2. Validación pura (`server/src/gremios/gremios.ts`)

Sin tocar BD ni red — testeable en aislamiento (`server/test/gremios.test.ts`):
- `nombreGremioValido(nombre)`: 3–24 caracteres tras `trim()`.
- `colorGremioValido(color)`: pertenece a la paleta cerrada (case-insensitive).
- `emblemaGremioValido(emblemaId)`: existe en el catálogo cerrado.
- `colorPorDefecto()`: primer color de la paleta.

## 3. Caché en memoria (`server/src/gremios/contextoGremios.ts`)

Mismo patrón que `ContextoConstruccion`/`bdCompartida`: **una sola carga desde BD por proceso**, memoizada, mutada in-place por cada handler de mensaje en CUALQUIER room del proceso (Hub, regiones, capital comparten el mismo `ContextoGremios` porque comparten el mismo proceso Node — ver `docs/GDD_Construccion.md` §1bis para el mismo razonamiento aplicado a construcción).

```
GremioVivo { id, nombre, liderJugadorId, color, emblemaId, saldoBanco, miembros: Map<jugadorId, rol> }
ContextoGremios { porId, porJugador, porNombreLower }
```

- `obtenerContextoGremios(bd)`: getter memoizado, construye desde BD la primera vez que se llama.
- `porJugador` es el índice que hace O(1) la pregunta "¿este jugador ya tiene gremio?" — se consulta ANTES de tocar BD en `gremio:fundar`/`gremio:aceptarInvitacion` (defensa en memoria) y la tabla tiene además una restricción UNIQUE real (defensa en BD, por si dos requests de fundar coinciden) — ver §5.

## 4. Persistencia (`server/src/datos/bd.ts`)

Tres tablas nuevas (mismo patrón de dos motores — SQLite dev/tests, Postgres producción — tras la interfaz async `IAlmacenDatos`, ver `docs/GDD_Construccion.md` §2):

```sql
CREATE TABLE IF NOT EXISTS gremios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT UNIQUE NOT NULL,
  lider_jugador_id INTEGER NOT NULL,
  color TEXT NOT NULL,
  emblema_id TEXT NOT NULL,
  saldo_banco INTEGER NOT NULL DEFAULT 0,
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gremio_miembros (
  gremio_id INTEGER NOT NULL,
  jugador_id INTEGER NOT NULL,
  rol TEXT NOT NULL,                    -- 'lider' | 'miembro'
  ingreso_en TEXT NOT NULL,
  PRIMARY KEY (gremio_id, jugador_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gremio_miembros_jugador ON gremio_miembros(jugador_id); -- un jugador, un gremio
CREATE TABLE IF NOT EXISTS gremio_invitaciones (
  gremio_id INTEGER NOT NULL,
  jugador_id INTEGER NOT NULL,
  invitado_por INTEGER NOT NULL,
  creado_en TEXT NOT NULL,
  PRIMARY KEY (gremio_id, jugador_id)
);
```

- El índice único sobre `jugador_id` en `gremio_miembros` es la defensa en BD contra pertenecer a dos gremios a la vez (defensa en profundidad junto al chequeo en memoria de §3 — probado explícitamente en `datos.test.ts`).
- `crearGremio` hace INSERT del gremio y luego INSERT del primer miembro (el líder); si el segundo falla tras el primero haber tenido éxito (p. ej. el jugador ya estaba en otro gremio por una carrera), se hace DELETE compensatorio del gremio huérfano — no queda basura en `gremios` sin miembros.
- Detección de violación de UNIQUE por motor: SQLite (`node:sqlite`) tira un `Error` cuyo `.message` contiene `"UNIQUE constraint failed: ..."` (detectado por substring); Postgres (`pg`) tira un error con `.code === "23505"`.
- `ajustarFarycoins(jugadorId, delta)` / `ajustarBancoGremio(gremioId, delta)`: primitivas atómicas compare-and-swap de un solo UPDATE, reusadas tal cual entre saldo de jugador y banco de gremio — ver §0.
- **Farycoins en `jugadores`**: columna `farycoins INTEGER NOT NULL DEFAULT 0`. Como la tabla `jugadores` ya existía desplegada (primera vez en el proyecto que hace falta ensanchar una tabla ya viva, no crearla desde cero), SQLite necesitó el patrón `PRAGMA table_info(jugadores)` + `ALTER TABLE` condicional (SQLite no tiene `ADD COLUMN IF NOT EXISTS` portable); Postgres sí lo soporta nativo. Cubierto por un test de regresión que siembra un fichero SQLite crudo pre-migración.

## 5. Protocolo Colyseus (disponible en toda `RoomExteriorBase`)

Igual que construcción (`docs/GDD_Construccion.md` §1bis), el protocolo de gremios vive en la clase base y por tanto funciona en el Hub, en cualquier región y en la capital sin código por sitio — un gremio fundado en el Hub es el mismo gremio visible desde una región, porque comparten `ContextoGremios` y BD.

Cliente → Servidor:
- `"gremio:fundar" { nombre }` — crea el gremio, el emisor es el líder. Falla si el nombre está en uso o si el jugador ya pertenece a un gremio.
- `"gremio:invitar" { jugadorNombre }` — solo miembros del gremio. Si el invitado está conectado en el mismo proceso, recibe `gremio:invitacionRecibida` en tiempo real.
- `"gremio:aceptarInvitacion" { gremioId }` / `"gremio:rechazarInvitacion" { gremioId }`.
- `"gremio:expulsar" { jugadorNombre }` — solo líder.
- `"gremio:abandonar"` — cualquier miembro salvo el líder (el líder solo sale disolviendo, §0).
- `"gremio:disolver"` — solo líder. Borra el gremio y sus miembros; el saldo del banco se devuelve al líder antes de cerrarlo.
- `"gremio:actualizar" { nombre?, color?, emblemaId? }` — solo líder; color/emblema deben pertenecer a los catálogos cerrados.
- `"gremio:depositar" { cantidad }` — cualquier miembro, requiere saldo propio suficiente.
- `"gremio:retirar" { cantidad }` — solo líder, requiere saldo del banco suficiente.
- `"gremio:estado"` — pide el propio estado (roster completo si hay gremio, `null` si no). El cliente debe mandarlo al conectar (ver limitación §6).

Servidor → Cliente:
- `"gremio:estado" { id, nombre, color, emblemaId, saldoBanco, liderJugadorId, miembros: [{jugadorNombre, rol, ingresoEn}] } | null` — respuesta dirigida, nunca broadcast.
- `"gremio:invitacionRecibida" { gremioId, gremioNombre, invitadoPor }` — solo al invitado, solo si está conectado en ese momento (v1 no persiste invitaciones "pendientes de ver": si no está conectado, se pierde la notificación pero la fila en `gremio_invitaciones` sigue ahí para aceptar más tarde).
- `"gremio:error" { motivo }` — feedback de rechazo (nombre en uso, sin permiso, fuera de catálogo, sin saldo...).

## 6. Limitación conocida — sincronización oportunista del Schema

Igual que el inventario (Fase 2), todavía no hay `onJoin` async con `jugadorId` resuelto de antemano por sesión. Por eso las etiquetas públicas del gremio en el `Player` Schema (`gremioId/gremioNombre/gremioColor/gremioEmblemaId`) solo se actualizan cuando una acción de gremio TOCA a ese jugador estando conectado en la room ACTUAL — no hay barrido retroactivo. **El cliente debe mandar `gremio:estado` justo al conectar** para tirar de su propio estado y pintar su nametag correctamente desde el primer frame; si no lo hace, la etiqueta pública queda en blanco hasta la siguiente acción de gremio que le afecte.

## 7bis. Beneficios de gremio — inventario compartido + comprar propiedad con el banco (pedido 2026-08-30)

Confirmado por el streamer: *"el beneficio de tener gremio es que se puede compartir un banco con el dinero y el inventariado de objetos y que se puede comprar terrenos más fácil al unir dineros"*. El banco de Farycoins ya existía desde v1 (`gremios.saldo_banco`, `ajustarBancoGremio`, `gremio:depositar`/`gremio:retirar`) — esta pasada añade el inventario de objetos y usar ese banco para comprar propiedad.

- **Inventario compartido**: tabla nueva `gremio_inventario` (mismo shape EXACTO que la tabla `inventarios` de un jugador — `ancho`/`alto`/`siguiente_id`/`items` JSON — pero UNA sola fila por gremio, sin `contenedor_id`: un almacén colectivo, no cuerpo+mochilas). `bd.guardarInventarioGremio`/`cargarInventarioGremio`. Tamaño 10x10 (`ANCHO_INVENTARIO_GREMIO`/`ALTO_INVENTARIO_GREMIO`, más grande que el cuerpo 8x6 de un jugador a propósito). Cargado perezosamente por mensaje, NUNCA cacheado en `ContextoGremios` — mismo criterio que las propiedades comerciales (volumen pequeño, se prefiere releer siempre a arriesgar un desfase entre sesiones).
  - Mensajes: `gremio:inventarioEstado` (consulta), `gremio:inventarioDepositar {instanciaId, x, y, rot}` (cualquier miembro), `gremio:inventarioRetirar {instanciaId, x, y, rot}` (SOLO el líder, mismo criterio que retirar Farycoins del banco). Los tres reusan el `moverItem` puro ya existente (docs/GDD_Inventario.md) sobre el contenedor propio del jugador (`cuerpo`) y el del gremio — cero mecanismo nuevo de movimiento de ítems, solo un origen/destino distinto.
- **Comprar propiedad con el banco del gremio**: `bd.comprarOAlquilar` gana un parámetro opcional `gremioId` — con él, el precio sale de `ajustarBancoGremio` en vez del monedero del jugador comprador (el DUEÑO de la propiedad sigue siendo el jugador; el gremio solo puso el dinero). Los mensajes `inmueble:comprar`/`inmueble:alquilar`/`habitacion:comprar`/`habitacion:alquilar` ganan un campo opcional `origenPago:"gremio"`. Guard: **solo el líder puede pagar con el banco** (mismo criterio que retirar — gastar el banco común es, en el fondo, una retirada), resuelto en el helper compartido `comprarOAlquilarPropiedad` de `RoomExteriorBase.ts` (usado por `RegionRoom`/`InteriorRoom`).
- Probado: 4 tests nuevos en `server/test/datos.test.ts` (roundtrip de inventario compartido) y `server/test/economia.test.ts` (compra con banco de gremio, y que falla sin tocar nada si no hay fondos).

## 7. Fuera de alcance de v1 (pendiente, no bloquea)

- NPC en la capital que entregue "los papeles" del gremio (hoy el protocolo se dispara mandando el mensaje directamente; falta el diálogo/UI de cliente).
- Rangos/oficiales intermedios, tope de miembros, transferencia de liderazgo.
- ~~Beneficios mecánicos de pertenecer a un gremio~~ — **resuelto (2026-08-30), ver §7bis.**
- Parcelas o propiedades a nombre del GREMIO (hoy toda propiedad sigue siendo de un jugador individual — §7bis deja que el gremio PAGUE una compra, pero la fila de `propiedades.dueno` sigue apuntando al jugador; una propiedad cuyo dueño real sea el gremio como entidad sigue sin diseñar, ver `docs/GDD_Construccion.md`).
- Invitaciones persistentes "pendientes de ver" para jugadores desconectados en el momento de la invitación (la fila en BD existe, pero no hay notificación al reconectar).
- ~~Fuente de Farycoins iniciales (faucet)~~ — **RESUELTO (2026-08-30), ver `docs/GDD_Economia.md`**: nota obsoleta con datos ya incorrectos incluso en su momento (`farycoins` nace a 20, no a 0, `SALDO_INICIAL_JUGADOR`) — corregida 2026-09-03, mismo apunte duplicado en GDD_Propiedades.md §7 y GDD_Mercado.md §4.
