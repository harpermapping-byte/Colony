# GDD — Comercio jugador-jugador

**ESTADO: v1 IMPLEMENTADA Y VERIFICADA (2026-08-30).** Piezas: `server/src/rooms/schema/HubState.ts` (`ComercioSchema`/`OfertaComercioSchema`, `state.comercios`), `server/src/rooms/base/RoomExteriorBase.ts` (mensajes `comercio:*`, apertura mutua, todo-o-nada al confirmar, auto-cancelación por distancia/desconexión), `client/src/comercio/panelComercio.ts` (panel placeholder) + `client/src/game.ts` (tecla T, wiring). Probado: `npx tsc --noEmit` limpio en `server/` y `client/`, suite completa de servidor 453/453 (sin tests unitarios propios — lógica dentro de `RoomExteriorBase`, mismo patrón ya aceptado para mercado/gremios/producción, todos probados solo vía e2e o manualmente).

Pedido del streamer (2026-08-30): *"el comercio jugador con jugador ha de ser una pantallita que les salga a ambos como la del WoW, será acercándote al jugador que quieres comerciar y ambos deberíais dar la tecla de comercio (asigna una que no esté aún asignada)"*.

## 1. Tecla y apertura mutua

**T** (libre — q/e/b/f/c/v/g ya estaban asignadas). `comercio:solicitar` (sin payload): el servidor auto-apunta al jugador vivo más cercano dentro de `RADIO_INTERACCION` (mismo criterio "sin UI de targeting" que "coger"/`combate:iniciar`).

- Si nadie ha pulsado T hacia ti todavía: se guarda una solicitud con una ventana corta (`VENTANA_SOLICITUD_COMERCIO_MS = 8000`) y se avisa al objetivo (`comercio:propuesta`).
- Si el objetivo YA tenía una solicitud pendiente apuntándote a TI (mutuo, dentro de la ventana): se abre el comercio para ambos de inmediato — nace una entrada en `state.comercios` (`ComercioSchema`, clave `comercioId`), y cada sesión queda registrada en `comerciosPorSesion` (como mucho UN comercio activo a la vez).

## 2. Ofertas

`comercio:ofrecer {instanciaId}` / `comercio:quitarOferta {instanciaId}` — **instancia completa siempre, nunca una pila parcial** (pedido explícito): se copia `itemId`/`cantidad` tal cual están en el inventario real del jugador al `OfertaComercioSchema` de su lado (`ofertaA`/`ofertaB`, según quién es cada uno). Cualquier cambio de oferta de CUALQUIERA de los dos resetea `confirmadoA`/`confirmadoB` a `false` — nadie puede confirmar sobre un trato que ya cambió bajo sus pies. Con alguno ya confirmado, la oferta queda bloqueada hasta que se desconfirme (cambiándola).

## 3. Confirmar — todo o nada

`comercio:confirmar` marca el lado propio como listo; en cuanto AMBOS están confirmados, el servidor:

1. Clona (`structuredClone`) los dos contenedores reales.
2. Simula el intercambio COMPLETO sobre las copias (`simularIntercambio`, reusa `moverItem`/`buscarHueco` de `inventario/inventario.ts` — el mismo pipeline probado de mover ítems entre contenedores, cuerpo↔mochila).
3. Si algo no encaja (el destino no tiene hueco, o el ítem ya no existe porque el jugador lo soltó/gastó mientras negociaba), se aborta entero: nadie pierde ni gana nada, se resetean las confirmaciones y se avisa con `comercio:error`.
4. Si la simulación cuadra entera, se repite exactamente la misma secuencia sobre los contenedores REALES, se sincronizan ambos Schemas (`sincronizarContenedor`) y se cierra el comercio con `comercio:cerrado {motivo:"completado"}`.

## 4. Cancelación

`comercio:cancelar` (cualquiera de los dos, en cualquier momento), alejarse más de `RADIO_INTERACCION` (comprobado cada tick de `actualizarMovimiento`) o desconectarse (`onLeave`) cierran el trato sin mover nada — `comercio:cerrado {motivo:"cancelado"}` a quien siga conectado.

## 5. Cliente (placeholder)

`panelComercio.ts` — mismo criterio ya pactado con el streamer para combate/mascotas ("placeholder sencillo, la UI final se hace al final del proyecto"): dos columnas con lo que ofrece cada lado, botón confirmar/cancelar, y un campo numérico para ofrecer por id de instancia (sin rejilla arrastrable todavía — fase 3 de inventario, `docs/GDD_Inventario.md §7`, sigue pendiente). Se muestra/oculta solo, siguiendo `room.state.comercios` (mismo patrón reactivo que el panel de combate).

## 6. Fuera de alcance de esta v1

- Sin descuento por Carisma ni nada de `bonusAtributos.ts::descuentoComercio` — ese helper es para precios de tenderete/NPC, no para trueque jugador-jugador (trueque puro, sin farycoins de por medio).
- Sin historial ni límite de objetos por oferta más allá del hueco físico del contenedor destino.
