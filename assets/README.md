# Assets — modelos 3D reales (.glb) por entrada de catálogo

**Cambio de convención — ver `docs/GDD_Motor_3D_Props.md` para la decisión completa.** El juego pasó de sprites 2D a modelos 3D de vóxeles (cámara isométrica), así que el motor ya no busca `.png` para props/vegetación/fauna/rocas — busca `.glb`. El terreno (`terrenos/`) es la única excepción: se queda como textura 2D plana.

Cada archivo de aquí corresponde a una entrada de un catálogo ya existente (`baker/catalogo/*.json`, `interiores/catalogo/elementos.json`) — no hay ningún catálogo nuevo, solo se reutilizan los campos `variantes`/`variantesNombradas` y `colorDebug` que ya tenían.

## Cómo añadir/sustituir un modelo

Genera la pieza con el taller de vóxeles (fuera de este repo), exporta el `.glb`, y guárdalo con el nombre exacto que le toca (ver abajo). No hace falta tocar ningún archivo de configuración ni avisar a nadie — en cuanto el cliente pida ese `id`, el `GLTFLoader` lo carga automáticamente (`client/src/render3d/entityLoader.ts`). Mientras no exista el archivo, el motor pinta un cubo de color (`colorDebug` del catálogo) en su lugar exacto — así siempre ves dónde y a qué escala va cada cosa, aunque todavía no tenga arte final.

## Cómo está organizado

- `terrenos/<id>.png` — **se queda en 2D**, una textura de 32x32 por tipo de terreno (césped, arena, agua...). Tileset del suelo, nunca pasa a vóxel.
- `vegetacion/<id>_01.glb`, `_02.glb`... — un modelo por cada **variante** de cada especie de planta/árbol (varias variantes de la misma especie, no especies distintas — ver GDD sección 12.5 de `GDD_Bakeador_Exteriores.md`).
- `animales/<id>_01.glb`, `_02.glb`... — igual, por especie de animal (estático por ahora; animación/rig es trabajo aparte, ver `GDD_Motor_3D_Props.md`).
- `rocas/<id>_01.glb`, `_02.glb`... — igual, por tipo de roca/mineral.
- `interiores/<id>.glb` o `<variantId>.glb` — mobiliario/objetos de `interiores/catalogo/elementos.json` (numerado o con `variantesNombradas`, ej. `mesa_comedor_roble.glb`). Carpeta nueva, antes no existía ninguna para interiores.
- `personajes/<id>_01.glb`... — jugadores/NPCs. Sin catálogo de datos propio todavía (pendiente, ver `GDD_Motor_3D_Props.md`).

El número de variantes de cada especie sigue estando en su entrada del catálogo (campo `variantes`) — si cambias ese número, generas los `.glb` que falten con el taller de vóxeles y los guardas aquí.

## Placeholders 2D antiguos (`vegetacion/`, `animales/`, `rocas/` en `.png`)

Los PNG generados por `baker/src/generar_placeholders.js` siguen en el repo pero **ya no los lee el cliente 3D** — quedan como referencia visual (color/silueta) mientras generas el `.glb` equivalente de cada especie. Se pueden borrar más adelante, categoría por categoría, en cuanto tenga ya su modelo 3D real.

## Regenerar los placeholders 2D (legado, solo si aún los usas de referencia)

```bash
cd baker && node src/generar_placeholders.js
```

Sigue funcionando igual que antes (solo crea los `.png` que falten), pero ya no alimenta al juego — es una herramienta de apoyo visual, no del pipeline final.
