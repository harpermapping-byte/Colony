# Contexto: generador de muebles y personajes en vóxeles — proyecto Colony

Repo: `harpermapping-byte/Colony`, catálogo en
`interiores/catalogo/elementos.json`. Todo el taller vive versionado en
`taller-vox/` (antes vivía solo en el scratchpad de una conversación y
estuvo a punto de perderse — no volver a dejarlo fuera del repo).

## Lo que ya existe y funciona (probado)

- `generar_modelos.js` — generador de muebles por arquetipo (silla, mesa,
  cama, armario, cofre, cesta, colgado de pared, objeto pequeño,
  estructural) con detalle real (bisagras de cincha, tiradores de anilla,
  listones, llamas de antorcha, aro de candelabro de techo...), resolución
  variable por pieza (`resolverU`), y dos bugs reales ya arreglados:
  1. La cerradura/puerta se ponía siempre en el eje Z sin comprobar cuál era
     el lado ancho real de la pieza (ahora compara `gx` vs `gz`).
  2. Los cofres (`arcon`, `cofre_pequeno`, `baul_tesoro`, `baul_marinero`)
     tienen `esContenedor:true` y se clasificaban como armario — el orden de
     comprobación en `clasificar()` estaba mal.
- `exportar_glb.js` — exporta un mueble a `.glb` real con face-culling.
  Probado: armario ~21.850 vóxeles → 11.128 triángulos; Khronos
  `gltf-validator` limpio.
- `generar_personaje.js` + `exportar_personaje_glb.js` — personaje humanoide
  con ESQUELETO real (15 huesos) y skinning rígido por vóxel. **Ya
  ejecutado y verificado** (en la sesión anterior nunca se pudo correr):
  Khronos limpio, carga en three.js como `SkinnedMesh`, y el pivote de
  rotación de cada hueso es correcto (probado rotando el codo 90°). Se
  arregló un bug de unidades: huesos e `inverseBindMatrices` iban en
  vóxeles con la malla en metros — invisible en reposo, letal al animar.
- `visor/laboratorio.html` — visor/revisor (aprobar/rehacer) con subconjunto
  de prueba; `partA/C/D` son los fragmentos para ensamblar el visor completo
  de las 123 piezas. En su día se publicaron como Artifacts (capacidades
  `downloads`+`artifact`); si hace falta el URL, pedírselo al usuario o
  mirar el historial de artifacts.

## Siguiente paso natural

1. Animaciones del personaje (caminar/correr/pegar) como animation clips
   glTF encima del esqueleto ya validado — la malla y el skin no se tocan.
2. Arquetipos cuadrúpedo e insecto reusando el mismo patrón (jerarquía de
   huesos + exportador con skin).
3. Flujo de aprobación de muebles: cuando el usuario tenga la lista completa
   dirá "hazlo" → generar todos → revisar en el visor → aprobar/rehacer →
   exportar `.glb` de los aprobados → subirlos a `assets/` según la
   convención de `docs/GDD_Motor_3D_Props.md`.

## Decisiones ya tomadas con el usuario (no volver a preguntar)

1. **Animaciones**: el esqueleto + skinning se hace bien desde ya; las
   animaciones concretas se añaden más adelante sin tocar la malla.
2. **Arquetipos de cuerpo**: humanoide primero (PJ/NPC, altura variable);
   cuadrúpedo e insecto después con el mismo patrón.
3. **Integración en el juego**: el usuario quiere `.glb` real. El cliente ya
   es three.js con `GLTFLoader` (ver `docs/GDD_Motor_3D_Props.md` y
   `client/src/render3d/`) — el rig placeholder actual es
   `rigHumanoide.ts`; cuando el modelo vóxel real sustituya al placeholder,
   mantener la misma estructura de pivotes.
4. **Flujo de aprobación**: generar → revisar en visor → aprobar/rehacer →
   exportar y subir solo los aprobados.
5. Detección de muebles nuevos: **NO** automatizar — el usuario avisa cuando
   la lista crece.
6. `armadura` y `cesto` no existen en el catálogo actual — se usó `cesta_pan`
   como cesto real más cercano; si añaden `armadura`, darle forma entonces.
