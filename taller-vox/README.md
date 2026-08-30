# Taller de vóxeles — generador de muebles y personajes

Es el "taller de vóxeles" que menciona `docs/GDD_Motor_3D_Props.md`: las
herramientas que generan los modelos 3D de vóxeles del juego y los exportan
a `.glb` según la convención de `assets/`. Vivía fuera del repo (en una
conversación de IA que se perdió); ahora está versionado aquí para que no
vuelva a pasar. No forma parte del cliente ni del servidor: se ejecuta
offline con Node, sin dependencias, y solo sus `.glb` resultantes acaban en
`assets/`.

## Piezas

- **`generar_modelos.js`** — genera la geometría de vóxeles (grid + paleta +
  cajas) de cada mueble del catálogo de interiores, clasificado por
  arquetipo (silla, mesa, cama, armario, cofre, cesta, colgado de pared,
  objeto pequeño, estructural), con resolución variable por pieza. Lee
  `catalogo_extraido.json` (snapshot de los campos relevantes de
  `interiores/catalogo/elementos.json` — regenerar con `node extraer_catalogo.js`
  si el catálogo real cambia) y escribe `modelos_generados.json`.
  **Variantes nombradas (pedido 2026-08-30)**: cada `variantesNombradas` del
  diseño (p.ej. `cama_individual_pino`/`_roble_tallado`/`_desgastada`) ahora
  genera SU PROPIO modelo — antes todas salían idénticas al id base. El
  sufijo del id se lee como vocabulario libre (`resolverVariante`): un
  tono real si menciona una madera/metal/piedra/fibra conocida (roble,
  nogal, hierro, oxidado, granito, lana...), más `aplicarTallado`
  (ranurado ornamental genérico en la caja más alta) si menciona
  "tallado"/"tallada", más `aplicarDesgaste` (oscurecido aleatorio
  determinista por caja) si menciona "desgastada"/"agrietada"/"oxidado"/etc.
  Sin match = queda el aspecto de siempre. `node extraer_catalogo.js`
  regeneró el snapshot de 123→559 piezas base (cobertura completa de
  `elementos.json`, antes 437 piezas diseñadas no generaban nada); con
  variantes, 1187 modelos totales.
- **`generar_naturaleza.js`** — la ampliación del taller para todo lo SIN
  esqueleto (decisión del streamer; lo que tiene esqueleto sale de
  `personajes/`): árboles, arbustos, hierbas, flores, setas, cactus, algas,
  corales, rocas, menas y cristales. Lee DIRECTAMENTE
  `baker/catalogo/{vegetacion,rocas}.json` (~147 especies: mismo id,
  `colorDebug` como color base, su campo `variantes` como número de modelos
  por especie — cero catálogos nuevos) y clasifica cada especie en uno de
  14 arquetipos (ARBOL_CADUCO con frutos, CONIFERA con nieve, PALMERA,
  SAUCE, ARBOL_SECO, ARBUSTO con bayas, HIERBA, FLOR, SETA, CACTUS, ALGA,
  CORAL, ROCA con motas de mena, CRISTAL). Determinista por `id|NN`.
  Escribe `naturaleza_generada.json` (mismo formato que los muebles: lo
  consume `exportar_glb.js` tal cual).
  ```bash
  node generar_naturaleza.js        # subconjunto de prueba (19 especies)
  node generar_naturaleza.js todo   # catálogo completo (producción: lo corre el usuario)
  node prueba_render_naturaleza.js  # galería SVG en output/ para revisar formas
  ```
- **`generar_edificio.js`** — la pieza para el bakeador de ciudades: sustituye
  la caja de color por riqueza que hoy pinta `ciudades/` por un edificio de
  vóxeles de verdad (masa EXTERIOR — el interior real sigue siendo la room
  instanciada aparte a la que se entra por la puerta, esto no la reemplaza).
  Cero catálogos nuevos: lee `interiores/catalogo/tipos_edificio.json`
  (riqueza, rango de plantas altas, material preferido) para los ~41 tipos,
  `ciudades/catalogo/huellas.json` para el ancho×largo real que ya coloca el
  bakeador de ciudades, e `interiores/catalogo/materiales.json` para el
  `colorDebug` del muro (madera/piedra/marmol/adobe/ladrillo/estuco...).
  Clasifica cada tipoEdificio en 1 de 10 arquetipos (CHOZA, CASA, TALLER,
  POSADA, INSTITUCION, TEMPLO, MILITAR, TORRE, GRANERO, CASTILLO) construidos
  sobre piezas compartidas (cuerpo por plantas con voladizo/jetty opcional,
  puerta y ventanas "pintadas" en la fachada, tejado a dos aguas o piramidal
  por ESCALONES DE TAMAÑO FIJO — así la altura sale siempre proporcional al
  ancho real en vez de comprimirse en muchos pasos finos en un edificio
  grande —, almenas, chimenea con brasas en talleres con fuego, pórtico de
  columnas en edificios cívicos, torres de esquina con su propio tejado en
  el castillo). Siempre orientado con la puerta hacia -Z; la rotación real
  en el mapa la pone `ro` al colocar el prop, igual que el resto. Mismo
  formato `{grid,paleta,cajas}` — lo exporta `exportar_glb.js` tal cual.
  Determinista por `tipoId|NN`; `node --test test_edificio.js` (26 tests).
  Acepta además un `plan` de suelo por instancia (tercera arg de
  `generarEdificio`): con plan no tira dados de forma — usa el w/h real y
  las alas L/T/U exactas que decidió `ciudades/`, con su semillaInterior.

  **Pase de "que se parezcan a una casa Tudor de verdad" (2026-08-28,**
  **referencias visuales del streamer)**: el entramado de madera
  (`entramadoTudor`) ya no es un simple marco rectangular — lleva riostras
  diagonales en las esquinas de cada paño (`riostrasDiagonales`, escalón de
  1 vóxel) y ya no es exclusivo de la casa noble con voladizo: cualquier
  planta alta de un edificio de madera no humilde lo enseña (`opciones.tudor`
  decidido por el arquetipo), y posada/taberna SIEMPRE lo llevan sea cual
  sea su riqueza. Nuevo: ménsulas/corbeles bajo cada voladizo
  (`corbelesVoladizo`, antes solo una línea recta), jardineras de flores
  bajo una parte de las ventanas de casas modesta/noble
  (`jardineraBajoVentana`, `probJardinera`), y variedad real de color de
  teja/pizarra por semilla (`TEJAS`/`PIZARRAS`, antes un único tono fijo
  para todo el mapa). Densidad de ventanas bajada (antes una fachada ancha
  salía casi toda de cristal, ahora se nota más la madera vista — más
  fiel a la referencia). **Bug real arreglado**: un balcón podía dibujarse
  encima de una ventana ya pintada en la misma (planta,cara) sin
  comprobación alguna — `ventanasEnFachada` ahora devuelve sus huecos
  ocupados y el balcón los consulta antes de colocarse (reintenta hasta 6
  veces con otra combinación, se pierde ese balcón en vez de solaparse).

  **Nuevo eje de variedad: `nivel` (1/2/3)** — cuarto argumento opcional de
  `generarEdificio(tipoId, nn, plan, nivel)`, retrocompatible al 100% (sin
  pasarlo, comportamiento idéntico a siempre). Escala nº de plantas
  (nivel 1 = mínimo del rango, 3 = máximo) y densidad de decoración
  (porche/balcón/chimenea/jardinera) en CASA — la riqueza sigue decidiendo
  QUÉ es posible (tudor, balcón...), nivel solo cuánto sale. Pensado como
  el eje "casa nivel 1 / mejora 2 / mejora 3" que el streamer quiere para
  una futura progresión por tiempo/dinero — **el enganche de juego (qué
  desbloquea el nivel, cuándo sube) no existe todavía, sin diseñar, ver
  `docs/Backlog_Mecanicas_Futuras.md`**; esto solo construye el eje de
  variedad del generador. `generarTodo(soloPrueba, conNiveles)` multiplica
  por los 3 niveles cuando `conNiveles=true` sin tocar el modo de siempre.
  `node prueba_render_niveles.js` — galería SVG de verificación específica
  de este pase (casas en varios niveles + posada/taberna/molino).

  **Ampliación de variedad (pedido 2026-08-30)**: `ciudades/catalogo/huellas.json:alas`
  suma 6 tipos nuevos con ala en L (templo, granero, establo, banos_publicos,
  biblioteca_publica, escuela — antes solo 11 tipos podían salir en L, pese
  a que el mecanismo de fusión ya era genérico). Quinto argumento opcional
  `opciones = {estiloVentanaUnico: true}` en `generarEdificio(tipoId, nn,
  plan, nivel, opciones)`: fuerza que TODAS las ventanas del edificio
  compartan un solo estilo en vez de los 2 que siempre se mezclaban antes —
  retrocompatible (sin `opciones`, comportamiento idéntico a siempre, misma
  tirada de semilla). `node prueba_render_ejemplos_2026_08_30.js` — galería
  de verificación de este pase + de las variantes de mueble.
  ```bash
  node generar_edificio.js          # 1 edificio de ejemplo por arquetipo (10)
  node generar_edificio.js todo     # los ~41 tipos del catálogo (producción: lo corre el usuario)
  node generar_edificio.js niveles  # subconjunto de prueba × 3 niveles (90 modelos)
  node prueba_render_edificios.js   # galería SVG en output/ para revisar formas
  ```
- **`generar_edificios_ciudad.js`** — puente con `ciudades/`: lee la clave
  `edificios` (plan de suelo por instancia) del indice.json de una ciudad
  YA bakeada y genera el `.glb` de cada edificio siguiendo exactamente ese
  plan (forma, alas, plantas del interior anidado, misma semilla). Salida a
  `<carpetaCiudad>/edificios_glb/` — carpeta de PREVIEW: nada se sube a
  assets/ sin pasar el flujo de aprobación con el usuario.
  ```bash
  node generar_edificios_ciudad.js ciudades/output/pueblo-rio-3
  ```
- **`exportar_glb.js`** — exporta un modelo de mueble a `.glb` real con
  face-culling + GREEDY MESHING (las caras coplanarias del mismo color se
  fusionan en un rectángulo — se ve idéntico, porque los cambios de color
  siguen cortando rectángulo, pero un edificio entero baja de ~100k a ~3k
  triángulos y de ~6MB a ~200KB). Construye el glTF binario a mano, sin
  three.js.
  ```bash
  node exportar_glb.js modelos_generados.json armario armario.glb
  ```
- **`generar_personaje.js`** — esqueleto humanoide de 15 huesos
  (hips→spine→head; hombro/codo/muñeca ×2; cadera/rodilla/tobillo ×2),
  altura parametrizable en vóxeles, pose de reposo solo por traslaciones.
  Es el PROTOTIPO que validó esqueleto+skinning; para generar PJ de verdad
  usar `generar_pj.js`.
- **`generar_pj.js`** — generador PARAMÉTRICO de personajes sobre el mismo
  esqueleto de 15 huesos: sexo (hombre/mujer, con silueta y anatomía
  estilizada distintas — el PJ va desnudo hasta que exista la ropa), altura
  en metros (densidad fija de 32 vóxeles/m: un PJ alto tiene más vóxeles,
  no vóxeles más grandes), peso 0–1 (redistribuye grosores, barriga con
  peso alto), tono de piel, pelo (calvo/rapado/corto/melena/coleta), color
  de pelo y barba (ninguna/perilla/corta/completa). Determinista puro;
  `pjAleatorio(semilla)` deriva un PJ con mulberry32.
  ```bash
  node generar_pj.js test          # los 3 PJ de prueba -> vox/pj*.glb + índice
  node generar_pj.js params.json pj.glb
  node generar_pj.js semilla:123 pj.glb
  ```
- **`test_pj.js`** — suite del generador (`node --test test_pj.js`, 9 tests):
  tapas de articulación, culling intra-hueso, determinismo, siluetas por
  sexo/peso, altura en vóxeles, pelo/barba, y los 3 presets del test.
- **`exportar_personaje_glb.js`** — exporta el personaje a `.glb` CON
  esqueleto real: `skin`, `inverseBindMatrices`, `JOINTS_0`/`WEIGHTS_0` por
  vértice (skinning rígido: cada vóxel pertenece 100% a un hueso, sin
  mezcla).
  ```bash
  node exportar_personaje_glb.js 34 personaje.glb
  ```
- **`validar_glb.js`** — comprobación estructural rápida de un `.glb`
  (magic, chunks, accessors/bufferViews, índices, y si hay skin, que
  joints/IBM/atributos cuadren). Para la validación exhaustiva usar el
  validador oficial de Khronos (`npm i gltf-validator`).
- **`visor/laboratorio.html`** — visor/revisor (aprobar/rehacer) con un
  subconjunto de piezas embebido, para iterar rápido. `partA_head.html`,
  `partC_state.html` y `partD_app.html` son los fragmentos (estilos, estado,
  app) con los que se ensambla el visor completo de las 123 piezas.

## Estado (verificado 2026-08-27)

Toda la cadena está probada con Node 22:

- Muebles: `generar_modelos.js` → `exportar_glb.js` produce `.glb` que pasan
  el validador de Khronos con 0 errores y 0 warnings (armario: 21.850
  vóxeles → 11.128 triángulos, confirma el face-culling).
- Personajes: `exportar_personaje_glb.js` produce un `.glb` con esqueleto
  que pasa el validador de Khronos limpio, carga en three.js como
  `SkinnedMesh` con sus 15 huesos, y el skinning es correcto de verdad:
  rotando el codo 90°, la mano gira alrededor del pivote del codo
  manteniendo la distancia exacta.
- Bug arreglado (caras transparentes al animar): el face-culling eliminaba
  las caras entre vóxeles vecinos de huesos DISTINTOS (codo, rodilla,
  hombro, cuello) porque en reposo se tocan; al rotar el hueso, la
  articulación quedaba abierta y se veía el interior hueco. Ahora la cara
  solo se omite si el vecino es del MISMO hueso — cada segmento del cuerpo
  es una caja cerrada.
- Generador de PJ (`generar_pj.js` + laboratorio): probados los 3 PJ del
  test acordado (hombre 1,90 m corpulento con barba completa; mujer 1,62 m
  delgada con melena; hombre 1,58 m medio calvo con perilla) — 15 huesos y
  ciclo de andar correctos en los tres, sin errores de consola
  (`laboratorio-personajes/test.mjs` con Playwright + capturas).
- Bug arreglado al recuperar el trabajo: las traslaciones de los huesos y
  las `inverseBindMatrices` se quedaban en unidades de vóxel mientras la
  malla se escalaba a metros (`unit`); en reposo no se notaba (se
  cancelan), pero al animar los pivotes quedaban ~20× lejos de la malla.
  Ahora huesos e IBM usan las mismas unidades que la malla.

## Pendiente

Ver `CONTEXTO_PARA_NUEVA_SESION.md` — incluye las decisiones ya tomadas
(animaciones después sin tocar la malla; humanoide primero, cuadrúpedo e
insecto después; el flujo de aprobación de muebles antes de subir `.glb` a
`assets/`).
