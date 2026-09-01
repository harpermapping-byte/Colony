# GDD — Librería (muebles librería + libros)

**ESTADO: v1 IMPLEMENTADA (2026-09-01).** Piezas: `interiores/catalogo/elementos.json` (3 muebles librería), `items/catalogo/librosContenido.json` + `items/catalogo/generarLibros.js` (autoría de libros de catálogo), `items/catalogo/items.json`/`recetas.json` (18 libros + 3 librerías + libro en blanco, todas sus recetas), `server/src/construccion/catalogo.ts` (campo `libreria`), `server/src/rooms/base/RoomExteriorBase.ts` (reusa `cofre:*` para la estantería, protocolo nuevo `libro:*` para escribir/leer), `server/src/datos/bd.ts` (tabla `libros_generados`), `server/src/inventario/inventario.ts`+`HubState.ts`+`sincronizarSchema.ts` (`libroGeneradoId`), `client/src/economia/panelLibro.ts` (nuevo) + `client/src/construccion/panelCofre.ts` (botón "Leer"). Probado: server **1114/1114**, `librosGeneradosBd.test.ts` (4 tests nuevos), `interiores/test/catalogo.test.js` **42/42**, `tsc --noEmit` limpio en servidor y cliente, `vite build` limpio. Sin E2E de Chromium todavía (mismo hueco honesto que Mercado v2, ver §7).

Pedido del streamer (2026-09-01, verbatim resumido): *"...habrá varios muebles, librería baja, librería alta, librería doble, de diferentes materiales y colores. en este mueble se podrán meter libros... cada librería según su tamaño soporta X cantidad de libros... da igual el peso/tamaño, simplemente entran 20/30/40/50 libros... los libros habrá que hacer diferentes tipos (por color): cada oficio un color, el lore otro color, los que pueda escribir el jugador otro color... con pluma y tinta o carboncillo podrá escribir en estos libros exclusivos... esta blueprint de libro la creará [decide qué oficio] a nivel 3 de mesa... el resto de libros serán objetos creados por nosotros al iniciar juego... a la hora de generar interiores, en algunos determinados sí o sí librerías con libros aleatorios... para crear libros más fácilmente un archivo que yo pueda modificar (título, oficio/color, texto)... ventanita como los minijuegos, abres con clic, pasas páginas con clic izq/der, ves el texto o escribes si es tu libro especial."*

## 1. Tres muebles librería — mismo mecanismo que un cofre, sin protocolo nuevo

Decisión central: **una librería NO necesita un contenedor nuevo.** `Contenedor` (`inventario.ts`) ya es una rejilla `ancho × alto` en CASILLAS — nunca mira peso — así que "da igual el peso, entran N libros" ya era cierto del mecanismo de cofre existente, solo hacía falta darle forma exacta: `libreria: {capacidad: N}` (nuevo campo de catálogo, `catalogo.ts`) + `capacidadCofre()` (`RoomExteriorBase.ts`) devuelve `[N, 1]` en vez del cuadrado aproximado (`raíz(aportes.almacenamiento)`) que usa un cofre normal — una fila de N casillas de 1×1 (todo libro es `huella:[1,1]`, `apilable:false`) da la cuenta EXACTA de libros que caben, ni uno más.

Con `esContenedor: true` + `libreria: {...}`, una librería reusa el protocolo `cofre:consultar`/`cofre:meterItem`/`cofre:sacarItem` TAL CUAL — `cofreDe()` solo mira `entrada.esContenedor`, sin distinguir cofre de librería. **Cero mensajes nuevos para guardar/sacar libros.**

- `libreria_baja` (1×1, capacidad 20, carpintero N1) — `libreria_baja_craft`, madera_blanda.
- `libreria_alta` (1×1, capacidad 40, carpintero N2) — misma huella en el suelo que la baja, el doble de baldas.
- `libreria_doble` (2×1, capacidad 50, carpintero N3) — mesa `mesa_ensamblaje`, con `lingote_hierro` para la herrajería.

Las tres con `materialesCompatibles`/`variantes` (madera, 3 variantes) para "diferentes materiales y colores" (pedido explícito) — mismo criterio que el resto del catálogo de muebles, sin inventar un sistema de tinte nuevo. Colocación vía `requiereItemColocar` (craftear primero, plantar después con tecla B) — mismo patrón que silla_pino/mesa_comedor_pino/puesto_mercado_jugador, cero colocador nuevo.

**Acceso**: mismo gating que un cofre (`esDuenoOJarlDe`) — privado del dueño de la propiedad. Decisión propia, no especificada: el pedido no pide una biblioteca pública, y reusar el cofre 1:1 significa heredar también su gating sin coste extra. Una librería "de acceso público" queda fuera de v1 (§7).

## 2. Libros de catálogo — autoría en un archivo aparte, generador que rellena items.json solo

Pedido explícito: *"un archivo que yo pueda modificar y añadir: título, oficio/color, texto"*. Se resolvió con DOS piezas separadas:

- **`items/catalogo/librosContenido.json`** — lo único que el streamer edita a mano. Cada libro: `titulo` (prosa real, NO pasa por `nombreBonito.js` — es una excepción deliberada al mismo nivel que `EXCEPCIONES_FRASE`, porque aquí el texto YA es literario, no un id que traducir), `categoria` (`oficio`|`mecanica`|`lore`), `oficio` (solo si `categoria:"oficio"`, uno real de los 10), `paginas` (array de strings, una por página). El propio archivo lleva una clave `_formato` con las instrucciones completas.
- **`items/catalogo/generarLibros.js`** — offline, sin dependencias (mismo criterio "generar UNA vez, nunca en directo" del CLAUDE.md): lee `librosContenido.json` y mantiene sincronizada en `items.json` la parte MECÁNICA de cada libro (nombre = título verbatim, `tipo:"libro"`, huella/peso/apilable estándar, `colorDebug` según categoría/oficio, `categoriaLibro`/`oficioLibro`) — nunca toca `items.json` a mano. Libro nuevo → se AÑADE; libro YA generado antes (se reconoce por su `_nota`) cuyo `titulo`/`categoria`/`oficio` CAMBIARON → se REESCRIBE esa única línea sin tocar el resto del fichero; sin cambios reales → no toca nada (idempotente). Cualquier entrada dada de alta a mano (p.ej. `libro_en_blanco_jugador`) nunca se toca aunque comparta id. El TEXTO de las páginas no vive en `items.json` en ningún momento — el cliente lo lee directo de `librosContenido.json` — así que editar `paginas` de un libro ya existente es instantáneo, sin ejecutar el script; solo hace falta ejecutarlo si cambia `titulo`/`categoria`/`oficio`, o al añadir un libro nuevo. Uso: `node items/catalogo/generarLibros.js`.

**18 libros de partida** generados así: 10 de oficio (uno por cada oficio real), 3 de "mecánica" (guías in-universo de construcción/mercado/oficios — un tutorial disfrazado de libro, útil de verdad para un jugador nuevo), 5 de lore (fundación del asentamiento, un jarl viejo, bestiario, gremios, de dónde salen los Farycoins) — "varios aleatorios por lore para tener relleno y dejarme crear más a mi antojo" (pedido literal): el streamer añade cuantos quiera solo editando el JSON y re-ejecutando el generador.

### 2.1 Colores — 3 categorías pedidas + una separación propia añadida

- **10 colores, uno por oficio** (`COLOR_POR_OFICIO` en `generarLibros.js`) — pedido explícito ("cada oficio debe tener un color asignado").
- **Lore**: un color propio (azul profundo, "tomo antiguo").
- **Mecánica**: color PROPIO, separado de lore (verde-azulado, "instructivo") — el pedido los mencionaba juntos de pasada ("tutoriales, lore, normas, memes etc") pero darles colores distintos cuesta cero y ordena mejor la estantería; decisión propia, documentada por si el streamer prefiere fundirlos en uno.
- **Jugador** (libro en blanco): color crema/hueso, páginas vacías — coherente con "libro nuevo sin estrenar".

## 3. El libro en blanco del jugador — oficio elegido: curandero, nivel 3

Pedido: *"decide qué oficio le pega más a nivel 3 de mesa"*. Elegido **curandero** — no por intuición sino porque el catálogo YA tenía las piezas puestas antes de este pedido: `pluma_tintero` (herramienta de escritura, oficio curandero tier 1) y `pluma_oro_retorta` (tier 4) ya existían, además de mesas `escritorio_escriba` (tier 2) y `scriptorium_alquimico` (tier 4) — el propio catálogo ya asociaba "escritura" a curandero antes de que este pedido existiera. La mesa de tier 3 real de curandero es `estacion_boticario` — no es la más literaria del progreso, pero es LA de nivel 3 real (el pedido pedía nivel 3 explícitamente, no "la mesa que más pegue temáticamente").

- **`libro_en_blanco_jugador_craft`**: curandero N3, mesa `estacion_boticario`, insumos `pergamino`×3 + `cuero_curtido`×1 (tapas de cuero, páginas de pergamino).
- **Herramienta de escritura**: `pluma_tintero` — REUSADA tal cual, no se inventó "pluma y tinta" nueva. No se consume (herramienta, no material fungible) — el jugador solo necesita tenerla encima.

## 4. Escribir/leer — mismo patrón "blueprint por instancia" que sastre/carpintero legendarios, con una diferencia: SÍ se puede reescribir

`ItemInstancia.libroGeneradoId` (`inventario.ts`) — ausente/0 = libro en blanco sin escribir; >0 = ya escrito, el texto real vive en `libros_generados` (bd.ts: `id, autor_id, titulo, paginas (JSON), creado_en`), enlazado por este id — MISMO mecanismo exacto que `prendaGeneradaId`/`muebleGeneradoId` (blueprint que sobrevive fuera del catálogo estático). Replicado en `HubState.ItemInstanciaSchema`/`sincronizarSchema.ts`, sin un mapa de red tipo `blueprintsRopa` — a diferencia de una prenda (que otros jugadores VEN puesta y necesitan renderizar), el texto de un libro solo hace falta cuando alguien lo abre de verdad, así que se pide bajo demanda.

- **`libro:escribir {instanciaId, titulo, paginas}`** — exige tener el `libro_en_blanco_jugador` (esa instancia) Y una `pluma_tintero` en el cuerpo. Si la instancia YA tiene `libroGeneradoId`, solo su AUTOR puede reescribirlo (`actualizarLibroGenerado` — a diferencia de un blueprint de mueble/prenda, un libro SÍ se edita, no es un "molde" para copias); si no, crea una fila nueva y fija `libroGeneradoId` en la instancia. Tope 20 páginas / 2000 caracteres por página (placeholder de balance, evita un libro de 500KB).
- **`libro:leerGenerado {libroGeneradoId}`** — SIN gating de dueño: cualquiera que tenga el libro (comprado, encontrado, prestado) puede leerlo, solo su AUTOR puede reescribirlo. Los libros de catálogo (oficio/mecánica/lore) nunca pasan por aquí — el cliente los resuelve DIRECTO desde `librosContenido.json` importado, sin ida y vuelta al servidor.

## 5. Cliente — visor de libro + "Leer" en cualquier cofre/librería

`client/src/economia/panelLibro.ts` (nuevo) — "ventanita como los minijuegos" (pedido literal): título + página actual + Anterior/Siguiente por clic (mismo patrón DOM flotante que `panelCofre.ts`/`panelReclutador.ts`). Tres modos:
- **Catálogo** (texto fijo) — resuelto local desde `librosContenido.json` importado, sin red.
- **Leer generado** — pide `libro:leerGenerado`, muestra páginas cuando llegan; si el lector es el AUTOR, un botón "Editar" reabre en modo escritura con lo ya escrito precargado.
- **Escribir** (libro en blanco sin escribir, o editando el propio) — título + un único `<textarea>` donde las páginas se separan con una línea `---` (placeholder deliberado: "no un editor de páginas de verdad", mismo criterio "placeholder pulido, no diseño final" del resto de paneles de esta pasada), parseado en el cliente antes de mandar `libro:escribir`.

`panelCofre.ts` gana un botón "Leer" opcional por fila (`ITEMS[itemId].tipo === "libro"`) — aparece en CUALQUIER cofre o librería, un libro es legible dondequiera que esté guardado, no solo en una estantería.

## 6. Interiores bakeados — prioridad de aparición, no garantía dura

Pedido: *"en algunos interiores determinados que veas necesarios, sí o sí librerías con libros aleatorios"*. Las 3 librerías llevan `tiposSalaValidos: ["biblioteca","estudio",...]` (los tipos de sala `biblioteca`/`estudio` YA existían en `tipos_sala.json`, con tag `NOCOMUN_BIBLIOTECA`) + `isMandatory: true` — mismo mecanismo YA usado por `horno_pan` en panaderías (`colocarElementos.js`: prioridad `-2`, "garantiza que piezas clave CASI SIEMPRE aparecen", nunca al 100%). Encaje elegido a propósito: reusar el mecanismo existente en vez de inventar un "forzado absoluto" nuevo.

**Límite real, documentado sin rodeos**: `InteriorRoom.ts` (interiores bakeados de edificios NPC/ciudad) NO tiene HOY ningún soporte de `esContenedor`/cofre — los muebles decorativos de un interior bakeado son puramente visuales, sin inventario vivo. Esto significa que una librería que aparece en una biblioteca BAKEADA (NPC, no construida por un jugador) se ve, pero está VACÍA e inerte — "libros aleatorios dentro" solo es real HOY en una librería que un JUGADOR construye con tecla B (mismo camino que un cofre normal, totalmente funcional). Poblar interiores bakeados con libros vivos y saqueables es trabajo real de otra pieza (llevar `esContenedor` a `InteriorRoom.ts`), fuera de esta pasada — ver §7.

## 7. Fuera de alcance de v1 (pendiente, no bloquea)

- **Librerías bakeadas SIN contenido vivo** (§6) — decoración únicamente hasta que `InteriorRoom.ts` soporte cofres.
- **Sin E2E de Chromium** — verificado por unit tests (BD) + `tsc`/`build` limpios, sin abrir servidor+navegador real de punta a punta (mismo hueco honesto que Mercado v2).
- **Leer/escribir directo desde el inventario del cuerpo** (sin pasar por una estantería/cofre) — el "Leer" de hoy vive en `panelCofre.ts`; integrarlo en `panelJugador.ts` (la rejilla de inventario propio) es trabajo aparte, no tocado.
- **Librería de acceso público** (cualquiera puede consultarla, no solo el dueño) — hoy hereda el gating de cofre normal (dueño/jarl).
- **Tope de páginas/caracteres** — placeholders de balance (20 páginas, 2000 caracteres/página) a revisar si el streamer los ve cortos o largos.
