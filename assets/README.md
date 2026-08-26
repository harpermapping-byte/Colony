# Placeholders — sustitúyelos por tu arte cuando lo tengas

Cada archivo de aquí corresponde a una entrada del catálogo (`baker/catalogo/*.json`). Son círculos/cuadrados de color lisos a propósito — lo único que importa ahora mismo es el **nombre del archivo**, no cómo se ve.

## Cómo sustituir uno

Para cambiar el aspecto de algo (por ejemplo, el roble), busca su archivo (`vegetacion/roble_01.png`, `vegetacion/roble_02.png`...) y **sobrescríbelo con tu propia imagen, manteniendo exactamente el mismo nombre**. No hace falta tocar ningún archivo de configuración ni avisar a nadie — en cuanto el juego lea desde esta carpeta, usará automáticamente el archivo que haya ahí.

## Cómo está organizado

- `terrenos/<id>.png` — una textura de 32x32 por tipo de terreno (césped, arena, agua...). Esto es lo que forma el "tileset" del suelo del que hablamos en el diseño.
- `vegetacion/<id>_01.png`, `_02.png`... — una imagen por cada **variante** de cada especie de planta/árbol (recuerda: varias variantes de la misma especie, no especies distintas — ver GDD sección 12.5).
- `animales/<id>_01.png`, `_02.png`... — igual, por especie de animal.
- `rocas/<id>_01.png`, `_02.png`... — igual, por tipo de roca/mineral.

El número de variantes de cada especie está definido en su entrada del catálogo (campo `variantes`) — si quieres más o menos variantes de algo, cambias ese número en el catálogo y vuelves a generar los placeholders (ver abajo), y luego sustituyes los que hagan falta.

## Regenerar los placeholders desde cero

Si añades una especie nueva al catálogo (o cambias cuántas variantes tiene), vuelve a correr esto desde la carpeta `baker/` — **solo crea los archivos que falten, no toca los que ya hayas sustituido por tu arte**:

```bash
node src/generar_placeholders.js
```

## Importante

Esta carpeta todavía no la lee ningún juego — de momento el visor del bakeador sigue usando colores de depuración por código, no estos archivos. Conectar el cliente del juego para que cargue las imágenes de aquí es trabajo pendiente (ver `docs/Backlog_Mecanicas_Futuras.md`). Pero el nombre y la ubicación de cada archivo ya están fijados, así que puedes ir sustituyendo tu arte desde ya sin miedo a que cambie más adelante.
