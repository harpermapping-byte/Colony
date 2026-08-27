# Generador procedural de ropa — decisión y estado (v1, 3 prendas de prueba)

Documento de referencia — léelo antes de tocar `ropa/` o ampliar su catálogo. Sigue el mismo patrón que `GDD_Bakeador_Interiores.md` (mobiliario): catálogo como fuente de verdad, generación offline, determinismo por semilla.

## Decisión (confirmada con el streamer)

La ropa (y más adelante armaduras, armas de mano y herramientas visibles) es un módulo nuevo, `ropa/`, con su propio catálogo — igual patrón que `interiores/` para mobiliario: una entrada de catálogo por prenda, generación procedural en vóxeles a partir de esa entrada + un material + una semilla.

Reglas de diseño acordadas:

1. **Una vez puesta, la prenda es UNA sola pieza pegada a la piel** — no tiene física propia, ni hueso propio, ni colisión propia. Se cuelga del pivote del rig que le toque (`client/src/render3d/rigHumanoide.ts`: `torso`, `piernaIzq`/`piernaDer`, `brazoIzq`/`brazoDer`, `cabeza`) y hereda su animación gratis, exactamente como ya preveía el comentario de `rigHumanoide.ts` sobre "la futura ropa". El cliente debe fusionar los vóxeles de cada prenda en una única geometría por prenda (o por personaje) antes de colgarla del pivote — no una entidad física independiente.
2. **Catálogo por profesión/oficio, no "dos prendas de cada"**: el catálogo de prendas arranca deliberadamente corto (3 entradas) y crece guiado por los oficios/tags que YA existen en `interiores/catalogo/tipos_edificio.json` (campo `temaTaller`: herrería, carpintería, sastre, curtiduría, alfarería, joyería, herbolista, destilería, molino, pescador, aserradero) y por `interiores/src/roomTags.js` (`COMUN_AGRICULTURA`, `ESPECIAL_NOBLEZA`, `COMUN_MILITAR`...). `ropa/catalogo/profesiones.json` es el cruce oficio → prendas típicas, igual que `tipos_edificio.json` es el cruce edificio → salas típicas.
3. **Materiales reutilizados, no duplicados**: la ropa usa el MISMO catálogo `interiores/catalogo/materiales.json` que ya usan los interiores (mismo `colorDebug`, misma escala de `riquezaTipica`) — solo se añadieron ahí las fibras que faltaban para vestuario: `lino`, `lana`, `seda` (y se documentó `cuero` también como material de ropa, que ya existía). Cero catálogo de materiales nuevo.
4. **Personalización por zonas, no toda la prenda**: cada prenda declara `zonasColor` (partes que el futuro creador de personaje puede tintar — ej. el cuerpo de una camisa, los puños, el cuello) y `zonasFijas` (partes que SIEMPRE usan el color del material, nunca tinte del jugador — ej. remiendos, cordones, ribetes). El material en sí también cambia el aspecto más allá del color: lino/lana/seda tienen `tintable` y una gama de colores histórica coherente (seda admite colores vivos/saturados, lana y lino solo tonos tierra — ver notas en `materiales.json`).
5. **Detalle = más vóxeles, no más geometría "suave"**: si una prenda necesita más definición (una costura, una hebilla, un remiendo), la resolución sube en `voxelResolucion` de esa prenda — sigue siendo el mismo estilo de bloques que el resto del proyecto (rig, mobiliario, props), nunca una malla lisa.

## Referencia usada antes de generar (para que la silueta sea real, no inventada)

Antes de programar las 3 siluetas se buscó referencia real:

- **Camisa/túnica campesina**: túnica altomedieval de corte suelto pero NO bombacho (mito de Hollywood), cuello en V o redondo poco marcado, mangas hasta la muñeca. Fuente: [Construction of early medieval tunics — Projekt Forlǫg](https://sagy.vikingove.cz/en/construction-of-early-medieval-tunics/).
- **Pantalón/calza campesina**: ancho en la cadera, entallado hacia el tobillo, con cinturón (cuerda o cuero) — silueta estándar de calza de trabajo medieval, sin patrón específico de una sola fuente (no hay pantalón "puro" documentado igual de bien que la túnica; se optó por la silueta más citada en referencias de vestuario medieval genérico).
- **Gorro/cofia**: coif de lino ajustado al cráneo, con el borde inferior vuelto hacia fuera y cordón de atado bajo la barbilla — prenda cotidiana de los siglos XII-XV tanto para hombres como mujeres del pueblo llano. Fuentes: [Coif — Wikipedia](https://en.wikipedia.org/wiki/Coif), [Arming cap — Wikipedia](https://en.wikipedia.org/wiki/Arming_cap).

## Qué se implementó (v1)

- `interiores/catalogo/materiales.json` — añadidas fibras `lino`/`lana`/`seda` (documentadas con su uso y su gama de tinte histórica); `cuero` marcado también como material de ropa.
- `client/src/render3d/proporcionesRig.json` — medidas del rig (`altoPierna`, `altoTorso`, `ladoCabeza`, cajas de pierna/torso/brazo) extraídas de `rigHumanoide.ts` a JSON, para que `ropa/` lea las MISMAS medidas sin duplicarlas. `rigHumanoide.ts` ahora importa este JSON en vez de llevar las medidas a fuego — cero cambio de comportamiento (verificado con `tsc --noEmit`).
- `ropa/catalogo/prendas.json` — 3 prendas de prueba, una por slot (torso/piernas/cabeza): `camisa_lino_campesina`, `pantalon_lana_campesino`, `gorro_lino_campesino`. A propósito solo 3, no un catálogo completo — primero se valida el algoritmo.
- `ropa/catalogo/profesiones.json` — cruce oficio → tags de prenda + material preferido, para 12 oficios (los mismos `temaTaller` de interiores + campesino/noble/militar).
- `ropa/src/catalogo.js` — cargador del catálogo (mismo patrón que `interiores/src/catalogo.js`), lee `materiales.json` de interiores y `proporcionesRig.json` del cliente sin duplicarlos.
- `ropa/src/generarPrenda.js` — generador procedural: cada prenda es una pila de capas horizontales por parte del cuerpo (torso, cada manga, cada pierna, cabeza), con una función de silueta propia por `tipoPrenda` (camisa/pantalón/gorro) que da el vuelo del bajo, el entallado del puño/tobillo, el cinturón, el borde del gorro. PRNG determinista (`interiores/src/azar.js`, reutilizado tal cual) para la variación natural de color y para los remiendos. Cada vóxel sale con `{x,y,z,color,zona,parte,pivote}` — `pivote` dice a qué hueso del rig cuelga esa parte.
- `ropa/src/prueba_render_voxel.js` + `ropa/src/prueba_render_png.js` — vista de prueba isométrica (SVG, cero dependencias nuevas) + conversión a PNG con el Playwright global del entorno, para revisar las 3 prendas antes de tocar el cliente de verdad. Salida en `ropa/output/` (gitignored, igual que `baker/output/`/`interiores/output/`).

## Morfología del personaje (alto/bajo/gordo/delgado/hombre/mujer) — v1.1

Decisión confirmada con el streamer: la ropa debe acoplarse a la forma de CADA personaje desde el primer momento, no tener una talla fija.

Cómo se resolvió — **la prenda no tiene medidas propias, nunca**: se genera a partir de las medidas del cuerpo YA morfado + su margen de capa (`MARGEN_CAPA`). Los mismos tres valores de morfología (`altura`, `corpulencia`, `sexo`) alimentan al rig y al generador de ropa, así el acople es automático por construcción — no hay "ajuste de talla" posterior porque no hay tallas.

- `client/src/render3d/morfologia.json` — fuente única de las reglas: rangos de los sliders (`altura` 0.88–1.12, `corpulencia` 0.85–1.2), factores derivados por sexo (hombre: hombros 1.0/caderas 0.95; mujer: hombros 0.9/caderas 1.06) y el mapa `escalas` de qué factor multiplica qué medida de `proporcionesRig.json` (las alturas escalan con `altura`, los anchos/fondos con `corpulencia`, hombros/caderas además con el factor de sexo). **La cabeza no escala a propósito**: los gorros valen para cualquier morfología sin regenerar.
- `client/src/render3d/morfologia.ts` y `ropa/src/morfologia.js` — los dos aplicadores gemelos (TS para el rig, CJS para el generador). Son genéricos y diminutos (leer ruta del JSON, multiplicar): los NÚMEROS viven solo en el JSON; si se cambia el CÓMO se aplica, hay que tocar los dos (avisado en comentario de ambos).
- `rigHumanoide.ts` — `OpcionesRig.morfologia` opcional; el rig entero se construye sobre las proporciones morfadas de esa instancia (omitida = talla base, cero cambio para el código existente). `ALTO_RIG` sigue siendo la altura de talla base.
- `generarPrenda()` — `opciones.morfologia` opcional con la misma forma exacta.

Verificado con números (misma camisa, misma semilla, resolución de vóxeles constante — solo cambia el tamaño de celda): torso base 0.479 ancho × 0.508 alto; bajo+corpulento 0.575 × 0.447; alto+delgado 0.407 × 0.569; mujer 0.431 × 0.508 (hombros −10%, misma altura). Y visualmente con `prueba_render_voxel.js`, que genera las 3 morfologías extra de la camisa (`__bajo_ancho`, `__alto_delgado`, `__mujer`) desplazando también los PIVOTES morfados (hombros más anchos = mangas más separadas), igual que hará el rig real.

Pendiente de decidir cuando llegue el creador de personajes: dónde vive la morfología elegida (savegame/servidor) y si `corpulencia` se separa en dos sliders (musculatura vs grasa). El contrato con este módulo no cambia: `{ altura, corpulencia, sexo }` entra, prenda acoplada sale.

## Resultado de la primera pasada (revisado visualmente)

Las 3 siluetas ya leen como lo que son (túnica con mangas y bajo abierto, calza con cinturón marcado en la cadera y entallado al tobillo, cofia con borde vuelto y cordón) y la fusión con los pivotes del rig cuadra con `rigHumanoide.ts`. Pendiente de una segunda pasada guiada por el streamer una vez vea las imágenes — candidatos ya identificados para ajustar: el gorro sale más "de pico" (cono) que de cúpula por cómo se estrecha el radio hacia arriba, la manga larga queda muy tapada por el propio torso en la vista isométrica (habría que revisar el ángulo o el ancho de manga), y el vuelo del bajo de la camisa es de una sola fila — puede que necesite 2-3 filas para leerse bien a la escala real del juego.

## Qué falta (pendiente, no bloquea lo anterior)

- Ampliar `ropa/catalogo/prendas.json` con el resto de oficios de `profesiones.json` una vez el algoritmo esté afinado (una prenda de torso/piernas/cabeza — y luego capas/calzado/manos — por cada combinación oficio×riqueza que haga falta), siguiendo el mismo criterio: nada de "dos prendas porque sí", cada una debe cuadrar con un oficio o tag real ya existente.
- Slot de manos/pies/capa exterior todavía sin definir en `prendas.json` (solo torso/piernas/cabeza en esta v1).
- Consumo real en el cliente: fusionar los vóxeles de una prenda en una única `BufferGeometry` y colgarla del pivote de `rigHumanoide.ts` — hoy la vista de prueba vive solo en `ropa/`, no hay integración con `client/`.
- Catálogo de armaduras/armas/herramientas (mencionado por el streamer como siguiente ampliación de este mismo módulo, no una lista aparte) — mismo patrón, pendiente de las primeras 3 prendas quedando aprobadas.
- Overrides de tinte por personaje (`tintes` en `generarPrenda()` ya existe como API, falta decidir dónde vive esa elección — savegame de personaje, servidor...).
