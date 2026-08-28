# GDD — Bakeador de Texturas

Módulo nuevo, `texturas/`, hermano de `taller-vox/`. Genera texturas tileables (canvas puro, sin dependencias) para el material de SUELO y PAREDES — césped, piedra, madera, arena, nieve, tierra, ladrillo, tela, superficies lisas. **No toca muebles/personajes/animales/edificios** (esos siguen siendo vóxel, decisión explícita del streamer) — es solo la capa de material de la geometría plana (suelo exterior, suelo/pared de interior).

Construido validando la técnica primero en una serie de prototipos rápidos en `/tmp` (no versionados) antes de escribir el módulo — mismo patrón de "afinar antes de programar" que el resto del proyecto.

## 1. Por qué esta técnica y no otra

Se probaron dos enfoques antes de llegar al de verdad:

1. **Ruido periódico "sumas de senos"** (frecuencia entera, cierra sin costura por construcción): tesela perfecto, pero se ve demasiado regular — un aspecto "de rayas diagonales" reconocible, nada orgánico.
2. **Ruido de gradiente real (fbm multi-octava, el mismo de `baker/src/ruido.js`) con "seamless noise"**: se mezclan 4 copias del mismo campo de ruido desplazadas ±N con peso bilineal (`u,v` = posición 0..1 dentro del tile) — el borde cierra EXACTO por álgebra pura (en x=0 y x=N el resultado usa las mismas 2 muestras con el mismo peso), sin perder el aspecto complejo/orgánico de un ruido de verdad. Esta es la que se usó.

No hizo falta llegar a Wang tiles (edge-matching real entre piezas con bordes distintos) — mucho más trabajo para el mismo resultado visual en un juego de estética vóxel/low-poly, no fotorrealista.

**Variantes que teselan ENTRE SÍ**: con una sola textura tileable, el ojo detecta el patrón en cuanto se repite muchas veces (siempre la misma pieza). La solución NO es generar muchísimas variantes para disimularlo — es compartir la MISMA base de ruido (macro+micro) entre las 3-4 variantes de una familia, y que la única diferencia sea "sellos" de detalle (musgo, nudo de madera, guijarro...) colocados siempre con margen respecto al borde (`MARGEN_SELLO_FRACCION`, proporcional a la resolución). Como la base es idéntica, CUALQUIER borde entre dos variantes distintas casa exacto — validado con test automático (`texturas/test/texturas.test.js`).

**Flores/piedrecitas/parches de tierra sueltos NO van horneados en la textura** — probado y descartado: con solo 3-4 variantes, la MISMA decoración siempre cae en la misma posición relativa cada vez que se repite esa variante, así que el ojo detecta una "rejilla de decoración" incluso peor que no tener decoración. Lo correcto es que esos elementos sueltos salgan del decorador de props normal (`baker/src/decoracion.js`, el mismo que ya esparce árboles/rocas/fauna con densidad real por casilla del MUNDO, no por textura que se repite) — **pendiente, no implementado en esta pasada** (ver §5).

## 2. Resolución — por qué 128px por defecto

La cámara isométrica es de zoom fijo (`TAMANO_MUNDO_VISIBLE = 16` en `worldScene.ts`): con un viewport típico, 1 casilla ocupa ~50-100px en pantalla según densidad de píxeles del dispositivo. 128px por casilla ya está en el límite de lo que se llega a ver — subir a 256/512 sin que el patrón cubra varias casillas antes de repetirse sería gastar cómputo/tamaño de archivo en detalle invisible. Si algún día un patrón cubre 2-4 casillas antes de repetirse (menos sensación de repetición a gran escala), la resolución debería subir proporcional para no perder nitidez por casilla — la escala del ruido (`escala`, en píxeles, NUNCA reescalada con N) está pensada para que esto sea posible sin rediseñar nada.

**Error real cometido y corregido durante el desarrollo**: escalar la `escala` del ruido proporcional a N para "más resolución" cambia el TAMAÑO de las formas (grietas más grandes), no su nitidez — la función quedó documentada (`ruidoTextura.js`) para no repetir el error.

## 3. Estructura del módulo

- `texturas/src/ruidoTextura.js` — primitivas: `ruidoSemblante` (ruido fbm tileable, con `estiramientoX/Y` opcional para vetas direccionales — **siempre aplicado DENTRO de la función, nunca premultiplicando la coordenada antes de llamarla**, bug real encontrado por el test de teselado: la madera no cerraba porque el estiramiento se aplicaba fuera y desalineaba la condición de borde), `tono` (aclara/oscurece un color, deriva claro/oscuro del único `colorDebug` del catálogo), `crearSello`/`colocarSellos` (decoración con margen).
- `texturas/src/familias.js` — 9 familias (`piedra`, `madera`, `tierra`, `cesped`, `arena`, `nieve`, `ladrillo`, `liso`, `tela`), cada una `(N, colorBaseHex, semilla) => {fondo, variante(i)}`. Una familia por ESTILO VISUAL, no por id de catálogo — añadir un terreno/material nuevo es una línea en `mapeoCatalogo.js`, nunca una familia nueva salvo que sea visualmente distinto de verdad ("las listas crecen, el código no").
- `texturas/src/mapeoCatalogo.js` — qué familia le toca a cada id de `baker/catalogo/terrenos.json` / `interiores/catalogo/materiales.json`. `agua`/`agua_profunda`/`lava` quedan EXCLUIDOS a propósito (ya llevan tratamiento especial — translúcida, con fondo visible, `PROFUNDIDAD_FONDO` en `worldScene.ts`; una textura estática ahí no pinta nada, si se anima de verdad será su propio generador).
- `texturas/src/index.js` — CLI: `node texturas/src/index.js [--resolucion N] [--variantes N]`, bakea TODO lo mapeado en las dos listas a `assets/terrenos/<id>_NN.png` / `assets/materiales/<id>_NN.png` (misma convención `<categoria>/<id>_<NN>.ext` del resto del proyecto). Un id sin familia asignada avisa por consola y se omite (nunca rompe el bake entero).
- `texturas/test/texturas.test.js` — cobertura (todo id no-excluido tiene familia), determinismo, teselado sin costura consigo misma, teselado cruzado entre variantes, validez del PNG generado.

## 4. Verificación

- 6/6 tests (`node --test texturas/test/texturas.test.js`), incluida la comprobación de teselado: el salto de color al unir un borde con el siguiente tile no es peor que un salto interno típico de esa misma familia (comparar contra CERO daba falsos positivos con la piedra: su capa de grietas es un umbral binario que amplifica cualquier diferencia pequeña de un campo continuo, tanto en el borde como en cualquier punto interior donde el ruido cruza el umbral).
- Verificación visual con mosaicos reales (5×5 y 6×6 tiles): madera y ladrillo, perfectos, cero costura visible. Piedra, césped, arena, tela: correctos con matices menores (tela sale un poco "de rejilla fina", se puede refinar cuando toque). Nieve tenía un bug real (`familias.js`, ya corregido): un segundo mezclado "de vuelta hacia el color base" con peso alto borraba casi toda la sombra, porque el `colorDebug` de la nieve es casi blanco puro y "volver hacia él" apenas se distingue de no hacer nada — ahora usa una sombra azul-gris fija en vez de oscurecer proporcionalmente un blanco que casi no tiene margen para oscurecerse.

## 5. Enganche al cliente — estado real

**Interiores (suelo/pared de habitación) — HECHO, mismo commit**: `interiores/src/colocarElementos.js` ya devuelve `materialSuelo`/`materialPared` por sala (dato que ya existía, sin usar en el render). `client/src/render3d/interiorVisual.ts` ahora, para cada sala, intenta cargar `assets/materiales/<materialPared>_01.png` / `<materialSuelo>_01.png` (nuevo `client/src/render3d/texturaLoader.ts`, mismo patrón caché+fallback que `entityLoader.ts`) y la aplica sobre el material YA CREADO (mutación in-place, no bloquea nada — si el PNG no existe todavía, sigue el color plano de siempre, exactamente como con edificios/muebles). Verificado sin regresión: cero PNG en `assets/materiales/` todavía, cero cambio visual, cero error de consola (Playwright, captura + sonda de errores).

**Suelo EXTERIOR (`sectorVisual.ts`) — NO enganchado, pendiente real**: el terreno exterior hoy es un único `<canvas>` por sector con 1 PÍXEL POR CASILLA (`crearTerrenoSector`), un color plano por tipo de terreno. Aplicar una textura de verdad ahí no es "añadir un loader con fallback" (como en interiores o edificios) — requeriría redibujar cada casilla del canvas del sector con un recorte de la textura tileable en vez de un `fillRect`, lo que implica MUCHA más resolución de canvas por sector (hoy 320×320px para un sector de 320×320 casillas; con textura real necesitaría más como 320×16=5120px de lado si son 16px de detalle por casilla) — coste de memoria/CPU por sector a evaluar antes de tocarlo, decisión de diseño aparte, no un cambio contenido. Sigue con color plano por ahora.

## 6. Qué falta (pendiente real)

- **Decoración suelta (flor/piedrecita/parche de tierra) vía el decorador de props normal**, no horneada en la textura (§1) — 2-3 entradas nuevas de baja densidad en `vegetacion.json`/`rocas.json`, sin código nuevo.
- **Suelo exterior real** (§5) — decisión de diseño de cómo subir la resolución del canvas de sector sin disparar el coste por sector.
- **`tela` se ve un poco "de rejilla fina"** — aceptable como primera pasada, se puede refinar el patrón de trama cuando toque revisar el aspecto final.
- **El bake real (`node texturas/src/index.js`) no se ha ejecutado sobre `assets/` todavía** — a propósito, decisión explícita del streamer: la maquinaria queda lista ahora, el bake de verdad (y su aplicación visible en el juego) se dispara más adelante, cuando se bakee todo el arte final del proyecto de una vez.
