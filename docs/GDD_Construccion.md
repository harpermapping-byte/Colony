# GDD — Sistema de Construcción, Parcelas y Propiedad

**Construcción-en-regiones (2026-08-29):** la ciudad capital (bakeada por `ciudades/`, tier `capital_jarl`) ya construye igual que el Hub — ver §1bis.

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-28).** Piezas: `parcelas/` (herramienta admin, puerto 4200, pincel+varita, demo real de 3 parcelas junto a la ciudad), `server/src/datos/` (persistencia con DOS motores tras la misma interfaz async `IAlmacenDatos`: SQLite/`node:sqlite` para dev/tests, **Postgres/Neon en producción — YA CONECTADO**, ver abajo), `server/src/construccion/` + HubRoom (validaciones §5, colisión viva con restauración, interior de edificio generado y persistido en `extra`), `client/src/construccion/` (modo B, fantasma verde/rojo, panel de 198 construibles, bordes de parcela, render de construcciones). Probado: server 23/23 (interfaz async validada), parcelas 10/10, e2e `client/test/construccion.e2e.cjs` (jarl asigna → construye 5 piezas incl. casa con interior de 2 salas → otro jugador las ve → reinicio de servidor y TODO persiste desde la BD) y los e2e previos (streaming, mecánicas) siguen verdes.

**Neon conectado (2026-08-28).** Proyecto `Colony` (`sparkling-hall-30232445`, org `harpermapping@gmail.com`), Postgres 18 en `eu-west-2` (Londres), rama `production`. `server/src/datos/bd.ts` tiene ahora `AlmacenDatosPostgres` (vía `pg`, pool sobre el endpoint "pooler" — PgBouncer incluido, correcto para un proceso siempre-vivo como Render, no el driver HTTP de Neon pensado para edge) además de `AlmacenDatosSqlite`; `crearAlmacenDatos()` elige el motor por `DATABASE_URL`. Las 3 tablas del esquema (`jugadores`, `propiedades`, `construcciones`) están creadas en la base real, y cada consulta (upsert de jugador con `RETURNING`, upsert de propiedad con `ON CONFLICT`, insertar/listar/borrar construcción) se validó una a una contra Neon de verdad vía el MCP antes de dar el driver por bueno (no se pudo probar el proceso Node completo porque este entorno de desarrollo no tiene salida de red directa a `neon.tech` — solo el conector MCP, que sí llega). `DATABASE_URL` ya está puesta en el servicio de Render.

~~**⚠️ Bloqueante: el servicio de Render (`srv-da23b5nqj5pc73dgcrag`, nombre "Colony") lleva fallando el build** — runtime Docker apuntando a un `Dockerfile` que no existe.~~ — **RESUELTO** (comprobado 2026-09-02 vía MCP de Render): ese servicio Docker ya no existe. El servicio real y correctamente configurado hoy es `colony-server` (`srv-daa8jdajnfac73frlc40`, Frankfurt, free, runtime Node, `rootDir` server, build/start tal como declara `render.yaml`), con un deploy exitoso registrado (commit `5581437b`, 2026-08-30). **Bloqueante ACTUAL, distinto**: ese servicio está **suspendido por el usuario** desde entonces — auto-deploy sigue activado sobre `main`, pero al estar suspendido ningún push posterior (incluidos los de esta sesión) se ha desplegado. El multijugador en producción, si se reanudara ahora mismo, arrancaría ~muchos commits por detrás. Reanudarlo es decisión del usuario (dashboard de Render); en cuanto se reanude debería ponerse al día solo por el auto-deploy ya configurado.

Diseño acordado con el streamer (2026-08-28) e implementación v1. **Este documento es el CONTRATO entre las piezas** (herramienta de parcelas, base de datos, servidor, cliente): los formatos y protocolos de aquí son la única fuente de verdad — si algo cambia, se cambia aquí en el mismo commit.

## 0. Visión pactada

- Alrededor de cada asentamiento del mapa exterior hay **parcelas orgánicas** (formas libres adaptadas al terreno, sin pisar caminos/agua) que el streamer delimita con una **herramienta admin** (y más adelante el jarl en juego, mismo dato).
- El **jarl** (líder del asentamiento) es el admin de tierras: asigna parcelas a jugadores y las revoca. Parcela sin dueño = del jarl/asentamiento.
- El dueño de una parcela **construye dentro de sus límites**: coloca muebles, empalizadas y edificios de los catálogos (todo lo generado SIN esqueleto; ropa/animales no). Estilo Project Zomboid: fantasma verde/rojo, snap a casilla, rotación en 4 orientaciones.
- **Colocar un edificio genera su interior** con el generador de interiores (determinista por semilla), en modo `amueblado: "vacio"`: salas vacías listas para amueblar.
- Un jugador puede tener **varias parcelas** (cultivo, animales, casa...) y también **inmuebles interiores** (habitación/local/casa en ciudad) — amueblar solo lo propio. **Implementado en `docs/GDD_Propiedades.md`** (compra/alquiler comercial, distinto de la asignación gratuita del jarl que describe este documento).
- Todo lo construido lo **ve cualquier jugador** (sincronizado) y **persiste** en base de datos.
- La **economía** (renta, compra/venta) y la **energía** (molinos) vienen después — pero el diseño ya les deja el hueco.
- Los catálogos mandan (regla 7 del CLAUDE.md): cuando crezcan las listas de muebles/edificios, el constructor los ofrece solo.

## 1. Parcelas — dato estático (`assets/mapas/principal/parcelas.json`)

Una parcela es un **conjunto de casillas** (máscara), no una forma geométrica — por eso puede ser todo lo orgánica que haga falta. Formato:

```json
{
  "version": 1,
  "mapa": "Mapa Inicial",
  "siguienteId": 4,
  "parcelas": {
    "p_0001": {
      "asentamiento": "ciudad",
      "nombre": "Huerto del este",
      "runs": [[1602, 1590, 1604], [1603, 1588, 1605]],
      "casillas": 421,
      "topeProps": 84
    }
  }
}
```

- `runs`: filas de casillas incluidas como `[y, x0, x1]` (ambos inclusive) — compacto y trivial de iterar. `casillas` y `topeProps` los cachea la herramienta (`topeProps` = casillas/5 redondeado, editable a mano).
- **Índice de pertenencia**: quien carga parcelas.json construye un `Map<clave, parcelaId>` con `clave = y*anchoMapa + x` (clave numérica, regla 4 del CLAUDE.md). Consulta O(1).
- **Casillas vetadas** (la herramienta no deja pintarlas y el servidor re-valida): terrenos `camino`, `puente`, cualquier agua (`requiereNadar`), `transitable: false`, y casillas ya en otra parcela.
- La herramienta vive en **`parcelas/`** (GUI web patrón baker/interiores, `node parcelas/gui/servidor.js`, puerto 4200): minimapa del mapa principal con pan/zoom (pinta sectores bajo demanda como el cliente), **pincel** de casillas (tamaños 1/3/7), **goma**, y **varita de crecimiento**: clic + tamaño objetivo → BFS desde la semilla que se expande SOLO por casillas válidas y para en fronteras naturales (caminos/agua/roca/parcelas) — parcelas orgánicas "del camino al río" en un clic, determinista, retocables con el pincel. Guardar → POST al serverito → escribe `parcelas.json`.

## 1bis. Construcción-en-regiones — la ciudad capital (pedido 2026-08-29)

**"La capital es un sitio como las aldeas y POIs, pero con reglas especiales."** Implementado generalizando v1, no como sistema aparte: `RoomExteriorBase.iniciarConstruccion(parcelas, asentamiento)` (antes solo en `HubRoom`) es ahora un método COMPARTIDO que cualquier room de movimiento libre puede llamar — `HubRoom` lo hace con las parcelas pintadas a mano de siempre; `RegionRoom` lo hace SOLO si el bake de esa región trae `parcelasReservadas` (campo nuevo de `indice.json`, hoy únicamente el tier `capital_jarl` — `ciudades/src/generar.js` §3bis, ver `docs/GDD_Ciudad_Capital.md`). Cualquier otra aldea/POI sin esas parcelas no llama al método: cero cambio de comportamiento.

- **Origen de las parcelas**: `ciudades/` ya reservaba hueco real (césped/tierra intacto, sin edificio) al bakear el tier `capital_jarl` — rectángulos con rotación LIBRE (no solo 0/90°), ajustados al trazado orgánico de calles. `server/src/construccion/parcelas.ts::cargarParcelasDeReservas` los convierte en el MISMO `IndiceParcelas` (runs `[y,x0,x1]`) que usa el Hub, rasterizando con la función `rasterizarRectRotado` que el propio bakeador ya usa para colocarlos (`require()` en runtime, mismo patrón que `economiaAsentamientos.ts` con `exportarAsentamiento.js`) — así la parcela cubre EXACTAMENTE las mismas casillas que el bake dejó libres, nunca una aproximación axis-aligned. Id determinista: `${asentamiento}:${tipo}_${índice}` (`tipo` = `"normal"` o `"especial"`, del bake).
- **BD compartida** (`server/src/datos/bdCompartida.ts`, nuevo): antes cada sitio abría su propio `crearAlmacenDatos()` (HubRoom, el chequeo de facción bandida en RegionRoom, el cooldown de mazmorra en DungeonRoom, el tick de economía en `index.ts`) — con Postgres/Neon eso es un Pool nuevo por cada uno, y con regiones visitadas constantemente el riesgo de agotar conexiones del free tier era real. Ahora hay UNA instancia memoizada por proceso; `cargarPropiedades()`/`listarConstrucciones()` siguen sin filtro por asentamiento (traen TODA la BD, todos los asentamientos comparten las mismas tablas `propiedades`/`construcciones`), así que `iniciarConstruccion` filtra client-side por pertenencia a `parcelas.parcelas` — nunca por nombre de asentamiento a pelo.
- **Protocolo**: idéntico al Hub, mismos mensajes (`parcela:asignar`, `parcela:revocar`, `construir`, `recoger`), mismo `esJarl()` (env `JARL_NOMBRES`, sin distinción por asentamiento — un jarl lo es en cualquier sitio v1).
- **Tope de props**: `TOPE_PROPS_PARCELA_REGION` (constante en `RegionRoom.ts`, hoy 30) — el bake no fija un tope por parcela reservada; mismo criterio "placeholder de balance a afinar" que ya usa `pesoMaximoTransportable`.
- **Verificado con un E2E manual contra un servidor Colyseus real** (mapa sintético con `parcelasReservadas`): un jugador normal no puede autoasignarse una parcela, el jarl la asigna, el dueño construye dentro de ella con el mismo protocolo del Hub, un tercer jugador ve los broadcasts (`construccion:nueva`/`construccion:quitada`) en tiempo real, el dueño recoge su propia construcción. Tests unitarios de `cargarParcelasDeReservas`: `server/test/parcelasReservadas.test.ts` (rasterizado sin rotar, rotado 90°, varias reservas sin pisarse, mismo `topeDe`/`runsDe` que las parcelas del Hub).
- Ninguna región DISTINTA de la capital tiene `parcelasReservadas` hoy (decisión de bake, no de código: cualquier tier que el streamer quiera abrir a construcción de jugador solo necesita que `ciudades/` le añada ese campo).

## 1ter. Proyectos especiales del jarl (2026-08-30)

Cierra el hueco que dejaba §1bis: las parcelas `tipo:"especial"` (proyectos comunales del jarl, 14 listados en `docs/Backlog_Mecanicas_Futuras.md` "Proyectos especiales del jarl") ya tienen tratamiento propio, distinto de las `"normal"`.

- **`Parcela.tipo`** (`server/src/construccion/parcelas.ts`): campo nuevo `"normal" | "especial"`, poblado desde `ParcelaReservada.tipo` en `cargarParcelasDeReservas` (antes solo viajaba en el `id` de la parcela, sin consumirse). Ausente en las parcelas pintadas a mano de `cargarParcelas` — se trata como `"normal"` (helper `tipoDe()`).
- **Flag de catálogo `proyectoJarl: true`** (`interiores/catalogo/tipos_edificio.json` y `interiores/catalogo/exteriores.json`, propagado en `EntradaConstruible`): a diferencia de `plantillaJarl` (mecanismo PARALELO, fuera de cualquier parcela — ver §"Plantillas" más abajo), `proyectoJarl` sigue viviendo en el "construir" normal de parcela — mismo `Map` que `construible`, genera interior igual que cualquier edificio (§5). Solo cambia la validación.
- **`validarColocacion()` (§5, regla nueva "1bis")**: si `entrada.proyectoJarl === true` exige (a) `esJarl(ctx, nombre)` — sin excepción de "eres el dueño de la parcela", por si alguna vez se asigna una parcela especial a un jugador por error; (b) `tipoDe(ctx.parcelas, parcelaId) === "especial"` — nunca en una parcela normal de jugador; (c) SOLO si `categoria === "edificio"`, tope de 1 por asentamiento (recorriendo `ctx.vivas`, que ya viene scoped a la room). Las piezas sueltas `categoria:"exterior"` del mismo proyecto (la Estatua del Líder: pedestal, banderines, un PAR de leones de piedra...) llevan `proyectoJarl:true` (solo jarl, solo parcela especial) pero SIN el tope de 1 — las limita el `topeProps` normal de la parcela, porque legítimamente hacen falta varias copias de una misma pieza decorativa.
- **13 de los 14 proyectos ya son `tipos_edificio.json` reales**: `taller_asedio`, `banos_comunales`, `casino`, `gran_catedral`, `establo_comunal`, `gran_herreria`, `molino_comunal`, `gran_mercado`, `salon_jarl`, `cuartel_guardia_comunal`, `academia_arcana`, `capitania_puerto`, `gran_archivo` — cada uno enlazado a su sala ya catalogada (`interiores/catalogo/tipos_sala.json`, las 10 salas dedicadas + las 3 reusadas `sala_juegos`/`cuadra`/`lonja`), verificado generándolos de verdad con 3 semillas cada uno (`interiores/test/catalogo.test.js`, 73 tipologías totales). El 14º, **Estatua del Líder**, es puramente exterior — sin interior, sin entrada en `tipos_edificio.json`: sus piezas (`estatua_lider_bronce` y el resto del monumento en `exteriores.json`) llevan `proyectoJarl:true` directamente. **Nota sobre "Molino"**: `molino_comunal` (jarl-only, tope 1, sala `sala_molino`) es un id NUEVO — coexiste con `molino_agua`/`molino_viento` (`construible` normal de CUALQUIER jugador, para la red motriz, GDD_Motriz.md), que ya usaban esa misma sala antes de esto; son conceptos distintos que comparten sala.
- **Fuera de alcance a propósito**: el CONTENIDO/servicio real de cada proyecto (que Baños Públicos rellene vitales, que Casino tenga minijuego, que Gran Herrería forje objetos con nombre propio...) sigue dependiendo de sistemas que no existen todavía (vitales-desde-edificio, economía, crafteo por planos) — este cambio solo abre el construible y genera el interior amueblado, igual que cualquier otro edificio nuevo del catálogo. Tampoco filtra el menú de construcción del CLIENTE por si el jugador local es jarl (`client/src/construccion/catalogoConstruccion.ts` expone `proyectoJarl` en `Construible` para cuando se aborde) — hoy un jugador normal puede intentarlo desde el menú y el SERVIDOR lo rechaza con un motivo claro (mismo camino que cualquier otra colocación inválida), no hay hueco de seguridad, solo una UX pendiente.
- **Tests**: `server/test/construccion.test.ts` ("§1bis: proyectos especiales del jarl") cubre las 3 reglas (jarl, parcela especial, tope 1 solo-edificio) sobre la lógica pura; `interiores/test/catalogo.test.js` confirma que los 14 tipos generan sin error (los 14/14 quedaron completos con `astillero` — docs/GDD_Barcos.md, 2026-08-30 — el único que faltaba por `construible`).

## 2. Persistencia — base de datos (`server/src/datos/`)

**Primera pieza de estado persistente del proyecto.** Capa única para TODO el estado vivo futuro (propiedades, construcciones y, cuando lleguen: inventarios, monedas, morfología del PJ...).

- **Motor dev/hoy**: `node:sqlite` (integrado en Node 22, CERO dependencias nuevas; experimental pero estable para SQL básico). Archivo `server/datos.sqlite` (gitignored). En Render el disco es efímero: vale para probar; **producción = Postgres gratuito (Neon)** — el streamer abre cuenta y pone `DATABASE_URL` en Render; el adaptador cambia de motor solo (misma interfaz, SQL portable). Hasta entonces, si `DATABASE_URL` existe se loguea "Postgres pendiente de driver" y se sigue en SQLite.
- **Regla**: el servidor NO hace trabajo de fondo con la DB — lee al arrancar/entrar, escribe al cambiar algo (colocar, asignar). Nunca polling.
- Interfaz `AlmacenDatos` (server/src/datos/bd.ts) con transacciones simples. Esquema (SQL portable, evitar sqlite-ismos donde se pueda):

```sql
CREATE TABLE IF NOT EXISTS jugadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT UNIQUE NOT NULL,          -- identidad v1 = nombre (hasta que haya login real; documentado)
  creado_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS propiedades (
  id TEXT PRIMARY KEY,                  -- "p_0001" (parcela) o "i_<edificioId>_<sala>" (inmueble interior, futuro)
  tipo TEXT NOT NULL,                   -- 'parcela' | 'inmueble'
  asentamiento TEXT NOT NULL,
  dueno INTEGER,                        -- FK jugadores.id; NULL = del jarl/asentamiento
  asignada_en TEXT
);
CREATE TABLE IF NOT EXISTS construcciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  propiedad TEXT NOT NULL,              -- FK propiedades.id
  objeto TEXT NOT NULL,                 -- id de catálogo
  categoria TEXT NOT NULL,              -- 'mueble' | 'exterior' | 'edificio'
  x INTEGER NOT NULL, y INTEGER NOT NULL,  -- casilla global (esquina noroeste de la huella YA rotada)
  rot INTEGER NOT NULL DEFAULT 0,       -- 0..3 (x90° horario; huella rotada = [h,w] en rot impar)
  variante INTEGER NOT NULL DEFAULT 0,
  extra TEXT,                           -- JSON: interior generado (edificios); estado futuro (energía...)
  creado_en TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_construcciones_prop ON construcciones(propiedad);
```

## 3. Catálogos — qué se puede construir

El menú de construcción se monta LEYENDO catálogos, nunca listas propias:

- **Muebles**: `interiores/catalogo/elementos.json` — todos los que no sean `capa: "estructural"` ni `specialModifier` de enemigo. Ya traen `huella`, `colorDebug`, `colocacion`/anchors, `variantes`. Campo nuevo OPCIONAL `receta` (materiales, se rellenará al definir la economía; sin receta = gratis por ahora).
- **Estructuras exteriores**: `interiores/catalogo/exteriores.json` (NUEVO, mismo formato de entrada que elementos): empalizada_tramo, empalizada_puerta, valla_madera, poste_antorcha, pozo, gallinero, bancal_cultivo... con `huella`, `colorDebug`, `variantes`, `uso` y `colision: true|false`.
- **Edificios**: `interiores/catalogo/tipos_edificio.json` — los que lleven `construible: true` + `huellaExterior: [ancho, largo]` (campos nuevos aditivos; el bakeador de interiores los ignora). Al colocarse generan interior (§5).
- **Campo reservado `energia`** en cualquier entrada: `{consume: n}` o `{produce: n, fuente: "viento"|"agua"|"movimiento"}` — sin efecto hoy; los molinos del futuro serán entradas de catálogo, no reformas.
- Regla de colisión de lo construido: ocupa sus casillas de huella como SÓLIDO en la rejilla del servidor salvo `colision: false` explícito o anchor `FLOOR_DECAL` (alfombras/bancales pisables).

## 4. Protocolo Colyseus (room hub)

Identidad v1: el `nombre` del jugador (limitación conocida hasta que exista login; el jarl se define con la env `JARL_NOMBRES="Nombre1,Nombre2"`).

Cliente → Servidor:
- `"parcela:asignar" { parcelaId, nombreJugador }` — solo jarl. Crea jugador si no existe.
- `"parcela:revocar" { parcelaId }` — solo jarl. Las construcciones QUEDAN (pasan con la parcela al jarl — decisión v1: revocar no borra lo construido).
- `"construir" { objeto, categoria, x, y, rot, variante }` — validación completa en servidor (§5).
- `"recoger" { construccionId }` — solo dueño de la propiedad (o jarl). v1: el objeto desaparece (cuando exista inventario, se devolverá).

Servidor → Cliente:
- `"parcelas:estado"` (al entrar y tras cada cambio): `{ [parcelaId]: { dueno: nombre|null } }`.
- `"construcciones:lista"` (al entrar): todas las construcciones (v1: pocas; cuando crezcan, filtrar por anillo de sectores del jugador).
- `"construccion:nueva" { id, propiedad, objeto, categoria, x, y, rot, variante }` / `"construccion:quitada" { id }`.
- `"construir:error" { motivo }` — feedback del rechazo.

## 5. Validaciones del servidor (autoritativo, como todo)

Al recibir `"construir"`:
1. El emisor es dueño de la parcela que contiene (x,y) — o jarl.
2. La huella ROTADA entera cae dentro de ESA misma parcela.
3. Todas sus casillas son TIERRA transitable en la rejilla (ni agua, ni sólido del bake, ni otra construcción).
4. La parcela no supera su `topeProps`.
5. (futuro) El jugador tiene los materiales de `receta`.

Si pasa: inserta en DB, endurece casillas (colisión viva — se guarda una copia `casillasBase` de la rejilla para poder restaurar al recoger), broadcast a todos.

**Edificio**: además genera su interior UNA VEZ con `generarEdificio({ tipoEdificioId, catalogos, semilla: "construccion|<propiedadId>|<x>_<y>", amueblado: "vacio" })` (require en runtime de `interiores/src` — el servidor ya lee catálogos hermanos) y lo guarda en `extra`. **Entrar/render del interior es OTRO hito** (el cliente aún no renderiza interiores — pendiente ya documentado en GDD_Motor_3D_Props); aquí queda generado y persistido, listo.

## 5bis. Concurrencia (testeo masivo 2026-09-01 — leer antes de tocar cualquier handler de construcción)

Colyseus **no serializa** los `onMessage` async entre sí (`Room._onMessage` llama al callback sin esperarlo): en cuanto un handler llega a su primer `await`, el bucle de eventos ya puede procesar el SIGUIENTE mensaje — de otro jugador, o del mismo jugador con doble clic/doble pestaña. Un testeo con dos sesiones reales mandando el mismo mensaje al mismo recurso a la vez (`client/test/concurrencia.e2e.mjs`) encontró y cerró tres carreras reales de este tipo:

- **`"construir"`/`"plantilla:colocar"` en la MISMA casilla**: `validarColocacion` (síncrono) se comprobaba UNA vez, con varios `await` (nivel de oficio, impuesto, insertar en BD) antes de `aplicarColocacion` — dos jugadores podían pasar la validación antes de que ninguno reservara la casilla en `ctx.ocupacion`, dejando dos construcciones solapadas persistidas (una "fantasma", no recogible por posición). **Fix**: revalidar `validarColocacion` justo antes de `aplicarColocacion` — de ahí en adelante no hay ningún `await` más, así que la revalidación y la escritura son atómicas de verdad (single-thread de JS); si alguien ganó la carrera se deshace lo ya hecho (borra la fila de BD, devuelve el ítem consumido) con el mismo criterio "débito + reembolso si se pierde la carrera" que ya usaba `comprarOAlquilar` (`bd.ts`) para dinero.
- **`"recoger"` sobre la MISMA construcción**: dos "recoger" solapados podían pasar los dos el check inicial (`ctx.vivas.get(id)` sigue existiendo mientras el primero espera a la BD) y procesar la baja dos veces. **Fix**: revalidar `ctx.vivas.has(id)` tras el único `await` del handler, y mover `quitarConstruccion` (la escritura sobre `ctx.vivas`/`ctx.ocupacion`) ANTES del `await bd.borrarConstruccion` — así la señal que lee la revalidación queda puesta de inmediato, sin ventana.
- **Estado de construcción por `viva.extra`** (cofres, curtidor, quesera, alquimia, crafteo, motriz, cultivo, comederos de granja, mesa de trabajador…): patrón repetido en ~20 handlers — lee `viva.extra` → `await` (BD/cálculo) → escribe `viva.extra` machacando lo que haya escrito mientras tanto otro mensaje solapado sobre la MISMA construcción (visto en vivo: `produccion:recolectar` duplicaba el stock cosechado; un cofre recién colocado podía perder el primer ítem metido porque cada handler se creaba su propio `Contenedor` vacío). **Fix**: `server/src/concurrencia/colaPorClave.ts` (`ColaPorClave`, con tests unitarios propios) — una cola de exclusión mutua por clave (`construccionId`); los handlers de estos ~20 mensajes se registran envueltos en `this.colaPorConstruccion.ejecutar(construccionId, () => manejarX(...))` en vez de directos. Mensajes con la MISMA clave se procesan uno tras otro (nunca solapados); con clave distinta no se bloquean entre sí (un cofre no frena a otro), así que no penaliza el resto del juego (`input` de movimiento a 30hz no pasa por esta cola).

De paso, el testeo destapó un bug de autorización sin relación con la concurrencia: `esDuenoOJarlDe` (guard de los 3 mensajes `cofre:*`) exigía que la propiedad YA tuviera un dueño asignado antes de comprobar si el emisor era jarl — una parcela recién tocada (`dueno: null`, el caso normal antes de que el jarl la reparta, §0 "parcela sin dueño = del jarl/asentamiento") dejaba sus cofres inaccesibles incluso para el jarl. Corregido para que el jarl pase primero, sin condición.

**Segunda pasada (auditoría 2026-09-02, pedido explícito: "rutas de trabajador... sin auditar").** Revisado sistemáticamente el resto de `onMessage` buscando el MISMO patrón lectura-await-escritura sobre estado compartido. Confirmado seguro por diseño (handler 100% síncrono, sin `await` — el single-thread de JS ya lo hace atómico, mismo criterio que `manejarCoger`): `mesa:sentarse`/`mesa:mover` (ajedrez), `cadaver:lootear`, `inventario:mover`. Encontradas y cerradas 3 carreras más de la misma familia, con dos colas nuevas además de `colaPorConstruccion`:
- **`trabajador:asignarMesa`/`asignarReceta`/`asignarRuta`/`despedir`** — `trabajadorPerteneceA` capturaba un snapshot de `NpcTrabajador` al principio; tras varios `await` el handler hacía `{...fila, campo: nuevo}` y lo escribía de vuelta, perdiendo lo que otro mensaje solapado sobre el MISMO trabajador hubiera escrito mientras tanto (p. ej. `asignarMesa` + `asignarReceta` casi a la vez). **Fix**: `colaPorTrabajador` (nueva `ColaPorClave`), keyed por `trabajadorId` — NO por `construccionId` (un trabajador cambia de mesa, la clave estable es él). De paso se corrigió `trabajador:asignarMesa`, que en la primera pasada se había envuelto con la clave equivocada (`construccionId`, que no protegía el recurso real).
- **`companero:asignarTrabajo`/`companero:llamar`/`plantilla:asignarTrabajador`** — mismo patrón que la familia `viva.extra` de la primera pasada (los tres tocan `viva.extra.produccion.trabajadorAsignado` de una plantilla de producción), simplemente no se habían cubierto en el barrido inicial. **Fix**: envueltos en la MISMA `colaPorConstruccion` de siempre — `companero:asignarTrabajo` puede tocar DOS construcciones (la nueva y la que el compañero dejaba), así que bloquea las dos por separado, nunca anidadas (sin riesgo de interbloqueo: son ids garantizado-distintos, ver comentario en el código). `companero:llamar` no conoce el `construccionId` hasta resolver `companero.propiedadId` dentro del propio handler, así que el lock se pide ahí dentro en vez de en el registro del mensaje.
- **`animal:recolectarProducto`/`sacrificar`/`consultar`** — igual que `produccion:recolectar` pero para `AnimalGranjaFila` (`fila.extra.produccion`, keyed por `animalId`): duplicaba el producto cosechado bajo la misma carrera. **Fix**: `colaPorAnimal` (nueva `ColaPorClave`), keyed por `animalId` — de paso cierra también un caso de "usar tras sacrificar" (recolectar producto de un animal que otro mensaje solapado ya borró).

**Riesgo residual aceptado, documentado en el código** (`resolverUnContrato`): NO se envuelve en ningún lock — se llama desde dentro de handlers que YA sostienen el lock de uno de sus dos recursos (origen o destino), y `ColaPorClave` no es reentrante (pedir la misma clave dos veces se autobloquearía). Ventana mucho más estrecha que las cerradas arriba: dos DISPARADORES distintos resolviendo el mismo contrato de transporte a la vez, y el próximo cálculo perezoso la corrige sola.

**Tercera pasada (2026-09-02, tras fusionarse la rama de Carros/agricultura de casilla)**: al revisar el hueco de ropa se detectó que ese merge trae sistemas nuevos con la MISMA forma de estado compartido — revisados todos:
- `carro:meterCarga`/`sacarCarga`/`meterMueble`/`sacarMueble`/`meterAnimal`/`sacarAnimal`/`verterLiquido` — YA seguían el patrón correcto (comentario propio en el código: "mismo criterio que guardarContenedorDeCofre") — `contenidoDe()` adjunta el contenedor recién creado de inmediato, igual que el fix de cofres, y el resto del handler es síncrono salvo el `await` final de solo-persistir. Sin carrera, sin necesitar cola.
- `cultivoCasilla:labrar`/`plantar` — leen `this.casillasCultivo.get(idx)` DESPUÉS de sus `await`, sin ventana. Seguros.
- `cultivoCasilla:cosechar` — SÍ tenía la carrera: leía la casilla ANTES de sus `await` (BD, híbridos) y la usaba después para calcular la cosecha — dos "cosechar" solapados (mismo jugador, dos pestañas) duplicaban el cultivo. **Fix**: nueva `colaPorCasilla`, keyed por `idxCasilla`; se envolvieron los 3 mensajes `cultivoCasilla:*` con la misma cola (labrar/plantar no la necesitaban hoy, pero así un refactor futuro que adelante su lectura no reabre el hueco en silencio).

## 6. Cliente — el constructor

- **Tecla B**: entra/sale del modo construcción (solo hace algo si pisas parcela propia). Panel HTML overlay (como los nametags CSS2D: DOM encima del canvas) con los objetos construibles agrupados por categoría, leídos de los catálogos importados al bundle (mismo mecanismo que `catalogoVisual.ts`).
- **Fantasma**: el objeto seleccionado sigue al ratón (raycast del puntero al plano y=0 con la cámara ortográfica), snap a casilla, **R rota** (0..3), color VERDE si el cliente cree que es válido (dentro de parcela propia + casillas libres — espejo de las reglas §5 para feedback instantáneo; la verdad sigue siendo del servidor), ROJO si no. Clic = `send("construir")`. ESC/B = salir.
- **Bordes de parcela visibles en modo construcción**: líneas en el suelo desde los `runs` (verde la propia, gris las ajenas).
- **Render de lo construido**: mallas por construcción con el pipeline de placeholder existente (caja `colorDebug` con dimensiones de huella; `.glb` real cuando exista vía `entityLoader`, misma convención de assets). Los edificios v1 = caja sólida de su `huellaExterior` (altura 2.1 como los solares urbanos del bakeador de ciudades). Se añaden/quitan por los mensajes del protocolo; se agrupan por sector para soltarse con el streaming.
- **Colocar desde inventario vs menú construcción**: DOS entradas al MISMO colocador (fantasma+validación+anclajes compartidos). El menú crea consumiendo receta (cuando haya economía); el inventario colocará objetos ya poseídos (cuando haya inventario). v1 implementa el colocador con el menú.

## 7. Extras pactados ("constructor brutal", v1)

- **Recoger** devuelve el objeto (v1: desaparece; con inventario, vuelve).
- **Permisos**: (v2, diseñado) lista blanca por propiedad para que amigos construyan.
- ~~Renta/economía jarl: (v2, diseñado)~~ — **resuelto (2026-08-30): impuesto del jarl configurable por propiedad (activar/desactivar, cantidad, cadencia), ver `docs/GDD_Economia.md` §6.**
- **Tope de props por parcela** — v1, en `parcelas.json`.
- **Plantillas** y **modo planos** — v2, SIN diseñar todavía (la referencia previa a "§0" era un enlace roto: §0 no contiene ese diseño). "Plantillas" en el sentido de construcción-en-regiones (§1bis, las `parcelasReservadas` de la capital) SÍ están implementadas; "plantillas" en el sentido de "el jarl coloca de antemano un edificio-tipo que un jugador compra ya hecho" (pedido separado, ver `docs/Backlog_Mecanicas_Futuras.md` "NPCs contratables para automatizar producción") sigue sin diseñar.

## 8. Qué falta tras v1 (no bloquea)

- Driver Postgres (Neon) cuando el streamer abra cuenta — solo el adaptador.
- Entrar a interiores construidos (bloqueado por el render de interiores en cliente, pendiente global).
- ~~Inmuebles interiores en ciudad~~ — **implementado, ver `docs/GDD_Propiedades.md`** (compra/alquiler comercial de inmuebles enteros y habitaciones sueltas de taberna/posada, 2026-08-29).
- Receta/materiales reales, permisos, renta, plantillas, planos, energía.
- Login real (Twitch) → sustituye la identidad por nombre.
- Jarl en juego pintando parcelas (misma máscara/formato; hoy solo la herramienta admin).
- **Edificios pequeños de construcción con catálogo/nombres PROPIOS (pedido 2026-08-29)**: el streamer no quiere que el menú de construcción ofrezca los mismos 5 tipos `construible:true` que hoy comparte con las ciudades (`casa_humilde`, `choza_pescador`, `casa_noble`, `taberna`, `tienda` — `interiores/catalogo/tipos_edificio.json`); pide bakes específicos, de tamaño pequeño, con ids nuevos que no se usen en `ciudades/catalogo/asentamientos.json`. **Encaje: cero fricción de arquitectura** — el mecanismo ya soporta esto tal cual (§3, §5): basta con dar de alta entradas nuevas en `tipos_edificio.json` (`construible:true`, `huellaExterior` pequeña, id nuevo, ej. `cabana_colono`/`taller_colono`) que ninguna calle de `ciudades/` referencie, y generar su `.glb` propio en `taller-vox/` (mismo generador; arquetipo nuevo solo si hace falta que se vean distintas de las de ciudad). El resto del menú (bloques/muebles/decoración) YA es "sin interior" — eso ya es `interiores/catalogo/elementos.json` + `exteriores.json`, sin cambio. Pendiente solo de que el streamer cierre la lista de nombres/tamaños cuando toque construirlo.
- **NPCs contratables para automatizar producción** — ver `docs/Backlog_Mecanicas_Futuras.md`, sección "NPCs contratables para automatizar producción": bloqueado por varias piezas que aún no existen (dinero, inventario/objetos, recetas de crafteo); el punto de fricción real con ESTE sistema es que un contrato entre dos parcelas necesita una ruta A* calculada UNA VEZ en runtime (al firmar el contrato), algo que hoy no existe — el A* de caminos solo vive como bakeador offline en `baker/src/`, nunca expuesto para llamarse en vivo.
- **Muebles/edificios legendarios (carpintero/ingeniero) sin resolver aquí todavía** (docs/GDD_Ropa_Procedural.md §Carpintero legendario/§Ingeniero legendario, pedido posterior al sastre) — el mueble tallado por un carpintero SÍ llega como item real al inventario (`silla`/`mesa_comedor`/`cama_individual`/`arcon`, vinculado a `muebles_generados`) pero colocarlo hoy (tecla B) da la geometría ESTÁTICA del catálogo, no la tallada: falta resolver el blueprint por-instancia al construir un `ConstruccionViva` cuyo item de origen traiga un id de `muebles_generados`, mismo tipo de límite ya aceptado para `equipoBlueprintRopa` de la ropa. El edificio proyectado por un ingeniero NO llega todavía a ningún item ni a este colocador — queda solo como blueprint persistente y listable (`edificios_generados`), pendiente de decidir cómo se ofrecería un "diseño propio" junto a las plantillas de `tipos_edificio.json` en la UI de construcción.
