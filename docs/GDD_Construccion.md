# GDD — Sistema de Construcción, Parcelas y Propiedad

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-28).** Piezas: `parcelas/` (herramienta admin, puerto 4200, pincel+varita, demo real de 3 parcelas junto a la ciudad), `server/src/datos/` (persistencia con DOS motores tras la misma interfaz async `IAlmacenDatos`: SQLite/`node:sqlite` para dev/tests, **Postgres/Neon en producción — YA CONECTADO**, ver abajo), `server/src/construccion/` + HubRoom (validaciones §5, colisión viva con restauración, interior de edificio generado y persistido en `extra`), `client/src/construccion/` (modo B, fantasma verde/rojo, panel de 198 construibles, bordes de parcela, render de construcciones). Probado: server 23/23 (interfaz async validada), parcelas 10/10, e2e `client/test/construccion.e2e.cjs` (jarl asigna → construye 5 piezas incl. casa con interior de 2 salas → otro jugador las ve → reinicio de servidor y TODO persiste desde la BD) y los e2e previos (streaming, mecánicas) siguen verdes.

**Neon conectado (2026-08-28).** Proyecto `Colony` (`sparkling-hall-30232445`, org `harpermapping@gmail.com`), Postgres 18 en `eu-west-2` (Londres), rama `production`. `server/src/datos/bd.ts` tiene ahora `AlmacenDatosPostgres` (vía `pg`, pool sobre el endpoint "pooler" — PgBouncer incluido, correcto para un proceso siempre-vivo como Render, no el driver HTTP de Neon pensado para edge) además de `AlmacenDatosSqlite`; `crearAlmacenDatos()` elige el motor por `DATABASE_URL`. Las 3 tablas del esquema (`jugadores`, `propiedades`, `construcciones`) están creadas en la base real, y cada consulta (upsert de jugador con `RETURNING`, upsert de propiedad con `ON CONFLICT`, insertar/listar/borrar construcción) se validó una a una contra Neon de verdad vía el MCP antes de dar el driver por bueno (no se pudo probar el proceso Node completo porque este entorno de desarrollo no tiene salida de red directa a `neon.tech` — solo el conector MCP, que sí llega). `DATABASE_URL` ya está puesta en el servicio de Render.

**⚠️ Bloqueante encontrado, AJENO a este cambio: el servicio de Render (`srv-da23b5nqj5pc73dgcrag`, nombre "Colony") lleva fallando el build desde antes de este commit** — está configurado con runtime Docker apuntando a un `Dockerfile` que no existe en el repo, cuando `render.yaml` (en la raíz) ya declara la config Node correcta (`rootDir: server`, `npm install && npm run build`, `npm start`). Ningún deploy de las últimas ~10 revisiones ha construido bien; el servidor multijugador desplegado probablemente no está sirviendo la versión actual del juego. Esto es un desajuste de configuración del servicio, no algo que el código del repo pueda arreglar — hay que reconfigurar el servicio en el dashboard de Render (cambiar su entorno de Docker a Node, con `rootDir: server`) o recrearlo desde `render.yaml`. Sin arreglar esto, `DATABASE_URL` está puesta pero el servidor que la usaría no se ha desplegado nunca con éxito.

Diseño acordado con el streamer (2026-08-28) e implementación v1. **Este documento es el CONTRATO entre las piezas** (herramienta de parcelas, base de datos, servidor, cliente): los formatos y protocolos de aquí son la única fuente de verdad — si algo cambia, se cambia aquí en el mismo commit.

## 0. Visión pactada

- Alrededor de cada asentamiento del mapa exterior hay **parcelas orgánicas** (formas libres adaptadas al terreno, sin pisar caminos/agua) que el streamer delimita con una **herramienta admin** (y más adelante el jarl en juego, mismo dato).
- El **jarl** (líder del asentamiento) es el admin de tierras: asigna parcelas a jugadores y las revoca. Parcela sin dueño = del jarl/asentamiento.
- El dueño de una parcela **construye dentro de sus límites**: coloca muebles, empalizadas y edificios de los catálogos (todo lo generado SIN esqueleto; ropa/animales no). Estilo Project Zomboid: fantasma verde/rojo, snap a casilla, rotación en 4 orientaciones.
- **Colocar un edificio genera su interior** con el generador de interiores (determinista por semilla), en modo `amueblado: "vacio"`: salas vacías listas para amueblar.
- Un jugador puede tener **varias parcelas** (cultivo, animales, casa...) y también **inmuebles interiores** (habitación/local/casa en ciudad) — amueblar solo lo propio.
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

## 6. Cliente — el constructor

- **Tecla B**: entra/sale del modo construcción (solo hace algo si pisas parcela propia). Panel HTML overlay (como los nametags CSS2D: DOM encima del canvas) con los objetos construibles agrupados por categoría, leídos de los catálogos importados al bundle (mismo mecanismo que `catalogoVisual.ts`).
- **Fantasma**: el objeto seleccionado sigue al ratón (raycast del puntero al plano y=0 con la cámara ortográfica), snap a casilla, **R rota** (0..3), color VERDE si el cliente cree que es válido (dentro de parcela propia + casillas libres — espejo de las reglas §5 para feedback instantáneo; la verdad sigue siendo del servidor), ROJO si no. Clic = `send("construir")`. ESC/B = salir.
- **Bordes de parcela visibles en modo construcción**: líneas en el suelo desde los `runs` (verde la propia, gris las ajenas).
- **Render de lo construido**: mallas por construcción con el pipeline de placeholder existente (caja `colorDebug` con dimensiones de huella; `.glb` real cuando exista vía `entityLoader`, misma convención de assets). Los edificios v1 = caja sólida de su `huellaExterior` (altura 2.1 como los solares urbanos del bakeador de ciudades). Se añaden/quitan por los mensajes del protocolo; se agrupan por sector para soltarse con el streaming.
- **Colocar desde inventario vs menú construcción**: DOS entradas al MISMO colocador (fantasma+validación+anclajes compartidos). El menú crea consumiendo receta (cuando haya economía); el inventario colocará objetos ya poseídos (cuando haya inventario). v1 implementa el colocador con el menú.

## 7. Extras pactados ("constructor brutal", v1)

- **Recoger** devuelve el objeto (v1: desaparece; con inventario, vuelve).
- **Permisos**: (v2, diseñado) lista blanca por propiedad para que amigos construyan.
- **Renta/economía jarl**: (v2, diseñado) — el streamer dijo "la economía ya se aplicará, ahora no".
- **Tope de props por parcela** — v1, en `parcelas.json`.
- **Plantillas** y **modo planos** — v2, diseñados en §0.

## 8. Qué falta tras v1 (no bloquea)

- Driver Postgres (Neon) cuando el streamer abra cuenta — solo el adaptador.
- Entrar a interiores construidos (bloqueado por el render de interiores en cliente, pendiente global).
- Inmuebles interiores en ciudad (`tipo: "inmueble"` ya existe en el esquema; se activará con los portales de ciudades).
- Receta/materiales reales, permisos, renta, plantillas, planos, energía.
- Login real (Twitch) → sustituye la identidad por nombre.
- Jarl en juego pintando parcelas (misma máscara/formato; hoy solo la herramienta admin).
- **Edificios pequeños de construcción con catálogo/nombres PROPIOS (pedido 2026-08-29)**: el streamer no quiere que el menú de construcción ofrezca los mismos 5 tipos `construible:true` que hoy comparte con las ciudades (`casa_humilde`, `choza_pescador`, `casa_noble`, `taberna`, `tienda` — `interiores/catalogo/tipos_edificio.json`); pide bakes específicos, de tamaño pequeño, con ids nuevos que no se usen en `ciudades/catalogo/asentamientos.json`. **Encaje: cero fricción de arquitectura** — el mecanismo ya soporta esto tal cual (§3, §5): basta con dar de alta entradas nuevas en `tipos_edificio.json` (`construible:true`, `huellaExterior` pequeña, id nuevo, ej. `cabana_colono`/`taller_colono`) que ninguna calle de `ciudades/` referencie, y generar su `.glb` propio en `taller-vox/` (mismo generador; arquetipo nuevo solo si hace falta que se vean distintas de las de ciudad). El resto del menú (bloques/muebles/decoración) YA es "sin interior" — eso ya es `interiores/catalogo/elementos.json` + `exteriores.json`, sin cambio. Pendiente solo de que el streamer cierre la lista de nombres/tamaños cuando toque construirlo.
- **NPCs contratables para automatizar producción** — ver `docs/Backlog_Mecanicas_Futuras.md`, sección "NPCs contratables para automatizar producción": bloqueado por varias piezas que aún no existen (dinero, inventario/objetos, recetas de crafteo); el punto de fricción real con ESTE sistema es que un contrato entre dos parcelas necesita una ruta A* calculada UNA VEZ en runtime (al firmar el contrato), algo que hoy no existe — el A* de caminos solo vive como bakeador offline en `baker/src/`, nunca expuesto para llamarse en vivo.
