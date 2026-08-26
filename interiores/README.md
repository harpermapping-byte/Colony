# Bakeador de interiores — catálogo, motor de generación pendiente

Diseño completo en `docs/GDD_Bakeador_Interiores.md`. Esta carpeta contiene el **catálogo** (materiales, tipos de sala, tipos de edificio, conectores verticales, puertas, ventanas y elementos) — el mismo primer paso que se siguió con el bakeador de exteriores (catálogo antes que motor).

## Qué hay ya

- `catalogo/materiales.json` — acabados de suelo/pared/techo (madera, piedra, ladrillo, estuco, papel pintado, tela/tapiz, metal, cristal).
- `catalogo/tipos_sala.json` — dormitorio, cocina, sala común, almacén, bodega, biblioteca, taller, pasillo, gran salón, sala de comercio.
- `catalogo/tipos_edificio.json` — casa humilde, choza de pescador, casa noble, taberna, tienda, castillo, torre militar — cada uno enganchado a POIs concretos del bakeador de exteriores (`baker/catalogo/pois.json`) vía `poiVinculado`.
- `catalogo/conectores.json` — escalera recta, de caracol, vertical/escala de mano, trampilla.
- `catalogo/puertas.json` — individual, doble, principal.
- `catalogo/ventanas.json` — sistema combinatorio (forma × tamaño × marco × cristal), no una lista de variantes fijas.
- `catalogo/elementos.json` — ~35 piezas de mobiliario/decoración/iluminación/suciedad, con reglas de sitio, huella y compatibilidad de material.

Todas las referencias cruzadas (tipo de sala, material, POI vinculado) están comprobadas contra el resto del catálogo — sin entradas huérfanas.

## Qué falta

- **El motor de generación en sí** (Wave Function Collapse para resolver la forma de cada planta, clasificación de sala, colocación de elementos con densidad/variantes, conducto de chimenea vertical, escaleras conectando plantas). Nada de esto está implementado todavía — es el siguiente paso lógico, igual que en exteriores se escribió primero `catalogo/*.json` y después `src/biomas.js`, `src/decoracion.js`, etc.
- Placeholders visuales (`assets/`) para las entradas de este catálogo — mismo mecanismo que exteriores, pendiente de generar cuando exista el equivalente a `generar_placeholders.js` para interiores.
- Ampliar el catálogo con más variedad (más tipos de sala, más tipos de edificio, más elementos) según se vaya necesitando — extensible por diseño, igual que exteriores.
