# GDD — Crafteo: materiales por tier, refinamiento y recetas

**ESTADO: PROPUESTA DE DISEÑO (2026-08-29), sin aplicar al catálogo/código.** Arquitectura acordada en conversación con el streamer para el sistema de crafteo que `docs/GDD_Profesiones.md` dejó como "pendiente, oficio a oficio". Aquí se fija la FORMA del sistema (dos capas, catálogos, cómo persiste); las recetas concretas de cada oficio siguen siendo trabajo posterior, oficio a oficio, con este contrato ya fijado.

## 0. Concepto (pedido literal del streamer, 2026-08-29)

Escalera de materiales POR FAMILIA (metal, madera, piedra, cuero, tela, precioso — cada una con su propia cadena, no un tier global): material base → refinado(s) → refinado(s) más avanzados, mezclando entre tiers y entre familias. Esos materiales alimentan recetas de CUALQUIER cosa (armas, armaduras, comida, muebles, herramientas, accesorios, y materiales de otros oficios). Una receta exige: plano desbloqueado + nivel de habilidad/oficio + mesa/zona correcta.

## 1. Dos capas, dos ritmos distintos

**Refinamiento (tier N → tier N+1): automatizado, "más Factorio"** — extiende `resolverProduccion` (docs/GDD_Produccion.md) con INSUMOS reales que se consumen (hoy la colmena/aserradero producen "de la nada"; el refinamiento consume stock de verdad). Cálculo perezoso, cero tick, igual que hoy: se resuelve al tocar la construcción. El trabajador (ya existe) activa la línea; la energía motriz (ya existe, `energia.consume`/`multiplicador`) acelera el ritmo — es EL caso de uso para el que Motriz se diseñó (fragua con martillo pilón mecanizado, refinando mineral→lingote más rápido que a mano). El transporte NPC (ya existe) mueve el output de una estación al insumo de la siguiente sin tocar nada de logística — mina→fragua→forja es una cadena de 3 construcciones con 2 contratos, con la maquinaria que ya existe.

**Crafteo del objeto final: activo, disparado por el jugador** — mesa correcta + plano desbloqueado + nivel de oficio suficiente, consume del INVENTARIO del jugador (no de un almacén automatizado), tarda un tiempo base multiplicado por `factorVelocidadPorEnergia` si la mesa está conectada a la red motriz (el gancho ya existe desde Motriz, sin usar todavía). Recetas TRANSVERSALES: una espada pide acero (herrero) + empuñadura de cuero curtido (curtidor) — al jugador solo le importa tener ambos en el inventario, no de qué oficio salió cada uno.

## 2. Familias y tiers — taxonomía de arranque

Cada familia es una escalera INDEPENDIENTE (el streamer confirmó: por familia, no global). Ejemplo completo con metal (el caso más claro, mina→fragua→forja) y esquema ligero para el resto — se rellena oficio a oficio cuando toque, mismo patrón:

| Familia | Tier 0 (crudo, ya en items.json) | Tier 1 (refinado, NUEVO) | Tier 2 (avanzado, NUEVO) |
|---|---|---|---|
| Metal | hierro, cobre, estano, oro, plata, platino, plomo | lingote_hierro, lingote_cobre, lingote_estano, lingote_oro, lingote_plata, lingote_platino, lingote_plomo | acero (lingote_hierro+carbon), bronce (lingote_cobre+lingote_estano) |
| Madera | madera_blanda, madera_abedul, madera_sauce, madera_palmera | **madera_dura ya existe y ya la produce el aserradero de Producción** — encaja sin tocar nada | madera_tratada (madera_dura+resina, NUEVO) |
| Piedra | piedra_comun, cuarzo | piedra_tallada, cristal_pulido (picapedrero/vidriero, ya dados de alta) | piedra_reforzada (piedra_tallada+metal) |
| Cuero/piel | cuero_grueso, cuero_reptil, piel_basta, piel_fina, piel_invierno, piel_exotica | cuero_curtido (curtidor, ya dado de alta) | cuero_endurecido (cuero_curtido+resina o metal) |
| Tela | fibra_vegetal | tela_hilada (sastre) | tela_reforzada |
| Precioso | gema | gema_tallada (joyero) | (entra directo en receta final, engarzada — no necesita tier 2 propio) |

**Comida NO sigue este patrón** — es ingrediente→plato, no una escalera de "dureza"; se craftea directo con el cocinero, fuera de esta taxonomía.

Nota real encontrada al mirar el catálogo: `madera_dura` YA es, sin que nadie lo llamara así, un tier 1 de la familia madera — el aserradero de Producción ya lo produce. Es la prueba de que el patrón encaja con lo que ya existe, no una invención nueva.

## 3. Catálogo — extensión de `items/catalogo/items.json` (aditivo)

```json
"lingote_hierro": {
  "peso": 1, "apilable": true, "stackMax": 20,
  "familiaMaterial": "metal",
  "tier": 1
}
```

`familiaMaterial` (string|null) y `tier` (entero, 0 = crudo) son campos NUEVOS opcionales — los ítems que ya existen sin ellos siguen funcionando exactamente igual (aditivo puro, mismo criterio que `energia`/`produccion` en construcción). El tier 0 de cada familia son los recursos crudos que YA tiene `categoriaRecurso` — solo hace falta añadirles `familiaMaterial`/`tier:0`, no crear nada.

## 4. Refinamiento — extensión de `DatosProduccion` (`server/src/construccion/produccion.ts`)

```ts
export interface InsumoProduccion {
  itemId: string;
  /** Consumido del almacén de la construcción por cada unidad de output producida. */
  cantidadPorUnidad: number;
}

export interface DatosProduccion {
  itemId: string;
  cantidadPorIntervalo: number;
  intervaloHoras: number;
  capacidadMax: number;
  requiereTrabajador?: boolean;
  /** NUEVO: si está presente, el refinamiento consume esto — sin insumos, se comporta EXACTAMENTE como hoy (colmena/aserradero, "de la nada"). */
  insumos?: InsumoProduccion[];
}
```

`resolverProduccion` necesita un dato más: el stock disponible de cada insumo en el almacén de la construcción (mismo `extra` que ya guarda el acumulador de output) — la producción se capa por el insumo más escaso, igual que `resolverTransporte` ya capa por stock/hueco. Sin insumos declarados, cero cambio de comportamiento (colmena/aserradero de Producción siguen igual). El almacén de insumos de una estación de refinamiento reutiliza el mismo mecanismo que un tenderete (`tenderete_items` — GDD_Mercado.md) para "cuánto stock tengo aquí", en vez de inventar una tercera forma de guardar cantidades.

## 5. Crafteo final — nuevo `items/catalogo/recetas.json` + protocolo `crafteo:*`

```json
"espada_hierro_basica": {
  "oficio": "herrero_armas",
  "mesas": ["yunque", "martillo_pilon"],
  "nivelMinimo": 2,
  "planoRequerido": "plano_espada_hierro_basica",
  "insumos": [
    {"itemId": "acero", "cantidad": 2},
    {"itemId": "cuero_curtido", "cantidad": 1}
  ],
  "resultado": {"itemId": "espada_hierro_basica", "cantidad": 1},
  "tiempoBaseSeg": 30
}
```

Flujo: jugador junto a una mesa con `temasProfesion` compatible → `crafteo:iniciar {recetaId}` → servidor valida (dueño del plano, nivel de oficio, insumos en el inventario, mesa correcta) → descuenta insumos → aplica `factorVelocidadPorEnergia` (ya existe, `server/src/construccion/energia.ts`) al `tiempoBaseSeg` → tras el tiempo, entrega el resultado al inventario (mismo mecanismo que "coger"). Mismo criterio de validación server-autoritativa que el resto del proyecto — el cliente solo sugiere.

## 6. Nivel de oficio (XP) — tabla nueva en BD

El streamer confirmó las DOS cosas del punto 4 combinadas, no una u otra: XP por oficio (sube con el uso, como ya decía el Backlog) Y tier de material como gate — se unen así: el nivel de oficio (derivado de XP) es lo que DESBLOQUEA qué tier puedes tocar, tanto para operar una estación de refinamiento de tier alto (asignarte como trabajador) como para intentar una receta de tier alto.

```sql
CREATE TABLE IF NOT EXISTS jugador_oficios (
  jugador_id INTEGER NOT NULL,
  oficio TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (jugador_id, oficio)
);
```

Nivel = función pura de XP (tabla de umbrales, ej. nivel 1=0xp, 2=100xp, 3=300xp...) — no se persiste el nivel en sí, se deriva, mismo espíritu que "nunca dupliques una fuente de verdad". XP sube al completar un crafteo activo (§5) — el refinamiento pasivo (§4) NO da XP (es automatizado, no es "el jugador practicando el oficio").

## 7. Fuera de alcance de esta propuesta (pendiente, oficio a oficio)

- Las recetas/planos concretos de cada oficio — esto solo fija el CONTRATO, no rellena los ~38 oficios.
- Cómo se consigue un plano nuevo (comprado/encontrado/enseñado por NPC) — sigue abierto en el Backlog, sin decidir.
- Umbrales exactos de XP por nivel, y cuánto XP da cada receta — placeholders a afinar como el resto de números de balance del proyecto.
- Si un personaje puede tener varios oficios a la vez o hay que especializarse — sigue abierto en el Backlog.
