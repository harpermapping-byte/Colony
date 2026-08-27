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
  `interiores/catalogo/elementos.json` — si el catálogo real cambia, hay que
  regenerar el snapshot) y escribe `modelos_generados.json`.
- **`exportar_glb.js`** — exporta un modelo de mueble a `.glb` real, vóxel a
  vóxel con face-culling (solo caras exteriores, estilo mesher de
  Minecraft). Construye el glTF binario a mano, sin three.js.
  ```bash
  node exportar_glb.js modelos_generados.json armario armario.glb
  ```
- **`generar_personaje.js`** — esqueleto humanoide de 15 huesos
  (hips→spine→head; hombro/codo/muñeca ×2; cadera/rodilla/tobillo ×2),
  altura parametrizable en vóxeles, pose de reposo solo por traslaciones.
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
