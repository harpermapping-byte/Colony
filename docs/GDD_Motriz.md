# GDD — Motriz (molinos, ejes, palancas, mesas de profesión)

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-29).** Piezas: `interiores/catalogo/elementos.json`+`tipos_edificio.json` (campo `energia`), `server/src/construccion/catalogo.ts` (`EntradaEnergia`), `server/src/construccion/energia.ts` (`potenciaDisponibleEnCasillas`/`factorVelocidadPorEnergia`), `server/src/construccion/construccion.ts` (validación "cauce adyacente" para molino de agua), `server/src/rooms/base/RoomExteriorBase.ts` (protocolo `motriz:*`). Probado: `server/test/energia.test.ts` (12), `motrizValidacion.test.ts` (5), suite completa 214/214, `npx tsc --noEmit` limpio, y E2E manual contra un servidor Colyseus real: molino de agua rechazado sin cauce y aceptado con cauce, cadena molino→eje→eje→palanca_freno→eje→yunque, `motriz:consultar` ve la potencia correcta a través de la cadena, frenar/desfrenar cambia la potencia disponible en vivo, un jugador ajeno no puede accionar la palanca de otro, accionar una pieza sin palanca es rechazado — 12/12 comprobaciones OK.

Sexto y último cluster del pedido original del streamer (2026-08-29, junto con gremios/propiedades/mercado/producción — ver `docs/Backlog_Mecanicas_Futuras.md`): transmisión de potencia mecánica desde molinos de agua/viento hasta mesas de profesión, con ejes/palancas de freno/palancas de cambios como piezas de tendido. Orden acordado: Farycoins → Gremios → Propiedades → Mercado → Producción → **Motriz**. Diseño investigado y propuesto antes de implementar (mismo patrón que Producción); antes de escribir código se confirmó con el streamer si el molino debía ser un edificio normal o un "proyecto especial del jarl" — eligió **construible normal**, como casa_humilde/taberna/tienda.

## 0. Decisión central: la red NO es una estructura de datos, es un BFS perezoso sobre lo que ya existe

Ningún componente de este cluster corre en un intervalo propio ni mantiene un grafo vivo. `potenciaDisponibleEnCasillas` (`server/src/construccion/energia.ts`) recorre por adyacencia de casilla el MISMO `ContextoConstruccion.ocupacion: Map<clave, id>` que ya usan parcelas/construcciones — la "tubería" que pedía el streamer es literalmente ese Map, sin estructura nueva (regla 7 CLAUDE.md). El BFS se ejecuta y se tira SOLO en el instante en que algo pregunta "¿tengo potencia?" (`motriz:consultar`, o el gancho `factorVelocidadPorEnergia` para un futuro sistema de crafteo) — nunca hay un tick que mantener, exactamente el mismo espíritu que `aplicarDesgasteInactividad` (inventario/desgaste.ts) y que el resto de cálculo perezoso del proyecto.

Comparación explícita con la única excepción real de tick del proyecto (`ejecutarTickEconomia`, 10 min, proceso entero, facción bandida): la red motriz no tiene ningún actor que deba "sentirse vivo" sin que un jugador la consulte — nadie necesita que el molino "siga produciendo" con el juego vacío. No hay justificación para copiar esa excepción aquí, y no se usa.

## 1. Campo `energia` — catálogo (aditivo, `server/src/construccion/catalogo.ts`)

```ts
export interface EntradaEnergia {
  produce?: number;                              // nodo FUENTE (molino): potencia constante que aporta
  fuente?: "agua" | "viento" | "movimiento";      // "agua" exige un cauce adyacente a la huella (§3)
  transmite?: boolean;                            // nodo de PASO (eje, engranaje, palancas): reenvía la conexión
  interrumpible?: boolean;                        // solo palanca de freno: extra.frenado puede cortar en caliente
  canales?: number;                               // solo palanca de cambios: nº de direcciones seleccionables
  consume?: number;                                // nodo de CONSUMO (mesa de profesión): potencia mínima para el bonus
  multiplicador?: number;                          // solo consumo: factor de velocidad cuando la red llega a `consume`
}
```

Se define en `catalogo.ts` (no en `energia.ts`) a propósito: `energia.ts` necesita importar `EntradaConstruible` (de `catalogo.ts`) y `ContextoConstruccion` (de `construccion.ts`) para recorrer la rejilla — si `EntradaEnergia` viviera en `energia.ts` y `catalogo.ts` la importara de vuelta, se cerraría un ciclo de imports. Mismo patrón aditivo que ya sigue `produccion` (docs/GDD_Produccion.md): se propaga sin tocar el resto de `cargarCatalogoConstruible()`/`cargarCatalogoPlantillas()` en las 4 ramas (elementos/exteriores/tipos_edificio ×2).

## 2. `potenciaDisponibleEnCasillas` — el BFS (`server/src/construccion/energia.ts`)

Recorre por 4-adyacencia desde las casillas de la pieza que consulta, acotado a `TOPE_NODOS = 200` (una red de una parcela normal tiene decenas de piezas, nunca cientos — coherente con "optimizado para gratis", regla 4). Un nodo con `en.produce` suma a `disponible`; un nodo `transmite` reenvía la conexión a sus vecinos; una palanca de freno **accionada** (`extra.frenado === true`) corta el paso sin expandir; una palanca de cambios solo deja pasar por la dirección de `extra.canalActivo` (selector EXCLUSIVO de una única salida, no un reparto proporcional — más simple de implementar y de leer visualmente, y evita tener que modelar consumo simultáneo entre varias mesas, ver §6).

**Bug real encontrado por el propio E2E, corregido antes de enviar**: una construcción con huella >1x1 (el molino de agua ocupa 9x10 = 90 casillas) se estaba contando **una vez por cada casilla de su huella** en vez de una vez por construcción — el molino aportaba 100×90 en vez de 100. El BFS ahora dedupe por `id` de construcción (`Set<number> procesados`) separando "contar produce" (una vez por id, en el primer encuentro) de "expandir vecinos" (en cada casilla visitada, para que una pieza vecina tocando CUALQUIER cara del molino conecte igual). Cubierto por un test dedicado (`energia.test.ts`, huella 3x3 sintética) y por el propio E2E con el molino_agua real de 9x10.

## 3. Molino de agua exige un cauce adyacente — validación nueva en `validarColocacion`

Único caso del proyecto donde una validación de colocación mira MÁS ALLÁ de la propia huella: si `entrada.energia?.fuente === "agua"`, al menos una casilla ORTOGONALMENTE adyacente (nunca dentro de la propia huella) debe ser `TIPO.AGUA` o `TIPO.AGUA_PROFUNDA`. Motivo de rechazo: `"el molino de agua necesita un cauce junto a su huella"`. El molino de viento (`fuente: "viento"`) no tiene esta restricción — se coloca en cualquier tierra libre normal.

## 4. Mensajes Colyseus (`motriz:*`, `RoomExteriorBase.ts`)

- **`"motriz:accionar" { construccionId, accion: "frenar"|"desfrenar"|"seleccionarCanal", canal? }`** — dueño de la propiedad (parcela) que contiene la pieza, o jarl. Valida que la pieza tenga de verdad `interrumpible`/`canales` según la acción pedida; muta `ConstruccionViva.extra` (`{frenado}` o `{canalActivo}`, JSON libre — mismo campo ya usado por Producción para el acumulador) y lo persiste con `bd.actualizarExtraConstruccion` (método ya existente, sin tocar). Broadcast `"motriz:estado" { construccionId, extra }` a toda la room.
- **`"motriz:consultar" { construccionId }`** → `"motriz:respuesta" { construccionId, disponible, fuentes }`, privado al que preguntó — opcional respecto al pedido original pero incluido por inmersión: sin él, un jugador no tiene forma de saber si montó bien su red hasta que exista un sistema de crafteo real que lo use indirectamente. Puro round-trip de lectura, coste cero de fondo (mismo patrón que `npc:hablar`/`npc:respuesta`).
- Errores: `"motriz:error" { motivo }`, mismo criterio que el resto del proyecto (solo al emisor).

La persistencia del estado (`frenado`/`canalActivo`) reusa exactamente el mismo mecanismo `ConstruccionViva.extra` + `construcciones.extra` (BD) + el bucle de recarga de `iniciarConstruccion` que Producción ya arregló para sobrevivir a un reinicio (docs/GDD_Produccion.md §5) — no hace falta ningún cambio adicional en ese bucle: una palanca es una construcción normal sobre una parcela, no un mecanismo paralelo como las plantillas del jarl.

## 5. Catálogo — piezas nuevas y extendidas

- **Nuevas en `elementos.json`**: `eje_transmision` (`transmite:true`, libre de sala), `palanca_freno_motriz` (`transmite:true, interrumpible:true`), `palanca_cambios_motriz` (`transmite:true, canales:4`), `molino_viento_pequeno` (mueble, `produce:20, fuente:"viento"`, huella 2x2 — la "versión mueble más pequeña" para parcelas pequeñas).
- **Extendidas (aditivo)**: `eje_transmision_molino`/`engranaje_madera_molino` (antes puramente decorativas de `sala_molino`, ahora `transmite:true` — si un jugador las coloca vía "construir" pasan a conducir potencia de verdad); `yunque_tocon` (`consume:15, multiplicador:1.5`; antes `yunque`, renombrado/fusionado en `docs/GDD_Profesiones.md` §0, 2026-08-30, mismo gancho portado), `torno_alfarero` (`consume:10, multiplicador:1.4`), `sierra_grande` (`consume:20, multiplicador:1.5`) — subconjunto pequeño y representativo, no las ~15 mesas con `temasProfesion`; el resto se extiende cuando el streamer confirme cuáles quiere beneficiar, es edición de catálogo pura. `martinete`, `banco_clasificacion_cincelado` y `molino_mano` (fusiones del mismo pase, ex `martillo_pilon`/`mesa_talla_piedra`/`muela_piedra`) también conservan su `energia` de siempre.
- **Nuevos en `tipos_edificio.json`**: `molino_agua` (id NUEVO, no reutiliza `molino` — ese sigue siendo el POI cosmético que bakea `ciudades/`; `construible:true`, `huellaExterior:[9,10]`, engancha por primera vez la `sala_molino` ya catalogada y hasta ahora huérfana, `produce:100, fuente:"agua"`) y `molino_viento` (`construible:true`, `huellaExterior:[6,6]`, reusa la sala `taller` genérica, `produce:80, fuente:"viento"`).

## 6. Decisiones deliberadas (y lo que queda fuera de v1)

- **Sin contención/saturación entre consumidores simultáneos**: cualquier mesa conectada ve el mismo `disponible` total, sin cola ni reserva. Modelar potencia que se agote entre varias mesas a la vez es un cluster de complejidad distinto (probablemente sí necesitaría algún estado compartido) — no se pidió y se deja fuera.
- **`energia.produce` es una constante de catálogo**, sin fluctuación temporal (nada de "viento variable por hora del día") — cualquier variabilidad real necesitaría un tick o un timestamp perezoso adicional que hoy no tiene ningún consumidor que lo justifique.
- **Sin sistema de crafteo real todavía** (0 referencias a "craft"/"receta" en el proyecto) — este cluster no lo inventa, pero `factorVelocidadPorEnergia(ctx, catalogo, mesa)` es el contrato exacto que ese sistema futuro consumirá: llamar UNA VEZ al empezar una acción con tiempo, nunca en cada frame.
- **Sin rotor/aspas girando visualmente en el cliente** — like el resto del arte del proyecto, es placeholder estático hasta que haya arte real; no hay precedente de pieza que gire de forma continua en `client/src/render3d/`.
- **La red no cruza de la rejilla exterior a un interior**: si más adelante los interiores generados se vuelven entrables y alguien mete piezas de transmisión dentro de un edificio, esa red no se conecta con la de la parcela exterior — son `ContextoConstruccion` completamente separados hoy. Extensión futura, no cubierta.
