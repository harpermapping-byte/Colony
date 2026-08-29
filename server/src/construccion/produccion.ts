/**
 * Producción pasiva (docs/GDD_Produccion.md, pedido 2026-08-29) — PURA (sin
 * Colyseus/BD/fs), mismo patrón que desgaste.ts: un acumulador de `stock`
 * con tope, resuelto SOLO comparando timestamps cuando algo lo toca de
 * verdad — nunca en un tick. La MISMA función sirve para una colmena
 * (autoproducción), una plantilla del jarl con trabajador (aserradero), y
 * el drenaje de un contrato de transporte hacia un tenderete — las tres
 * son "cuánto se ha acumulado desde la última vez que alguien miró".
 */

/** docs/GDD_Crafteo.md §4 — insumo real que el refinamiento consume del almacén de la construcción (tenderete_items reusado como "qué tengo aquí guardado"). Sin `insumos`, una plantilla produce "de la nada" — comportamiento EXACTO de antes (colmena, aserradero). */
export interface InsumoProduccion {
  itemId: string;
  /** Consumido del almacén por cada unidad de output producida — proporcional, no por lote. */
  cantidadPorUnidad: number;
}

export interface DatosProduccion {
  itemId: string;
  cantidadPorIntervalo: number;
  intervaloHoras: number;
  /** Tope de stock acumulable — SIEMPRE obligatorio: sin tope, una ausencia larga generaría cantidad ilimitada de golpe. */
  capacidadMax: number;
  /** true en plantillas del jarl (aserradero): sin trabajador asignado, el reloj se congela — no acumula. */
  requiereTrabajador?: boolean;
  /** docs/GDD_Crafteo.md — refinamiento real (tier N → tier N+1): sin esto, produce "de la nada" como hoy. */
  insumos?: InsumoProduccion[];
}

export interface EstadoProduccion {
  stock: number;
  /** epoch ms de la última vez que se resolvió el acumulador. */
  ultimoCalculo: number;
  trabajadorAsignado?: boolean;
}

/**
 * Resuelve cuánto se ha producido desde `estado.ultimoCalculo` hasta
 * `ahoraMs` — nunca negativo, nunca por encima de `capacidadMax`. Si
 * `datos.insumos` está presente, además capa por el insumo más escaso
 * disponible AHORA MISMO (`insumosDisponibles`, itemId→cantidad) — misma
 * simplificación ya aceptada en `resolverTransporte`: no rastrea CUÁNDO
 * dentro del intervalo se agotó el insumo, solo el stock actual, así que el
 * reloj avanza igual de "congelado" que el caso `requiereTrabajador`
 * mientras el insumo esté a cero.
 *
 * El llamador es quien descuenta el insumo del almacén — esta función es
 * PURA (no toca ninguna BD): `producido = nuevoEstado.stock -
 * estadoPrevio.stock`, y `consumo_i = producido * insumo_i.cantidadPorUnidad`.
 */
export function resolverProduccion(
  estado: EstadoProduccion,
  datos: DatosProduccion,
  ahoraMs: number,
  insumosDisponibles?: Map<string, number>,
): EstadoProduccion {
  if (datos.requiereTrabajador && !estado.trabajadorAsignado) {
    // sin trabajador: el reloj no acumula deuda retroactiva — se congela en el momento presente
    return { ...estado, ultimoCalculo: ahoraMs };
  }
  const horas = Math.max(0, (ahoraMs - estado.ultimoCalculo) / 3_600_000);
  let producido = (horas / datos.intervaloHoras) * datos.cantidadPorIntervalo;
  producido = Math.min(producido, datos.capacidadMax - estado.stock);
  if (datos.insumos) {
    for (const insumo of datos.insumos) {
      if (insumo.cantidadPorUnidad <= 0) continue;
      const disponible = insumosDisponibles?.get(insumo.itemId) ?? 0;
      producido = Math.min(producido, disponible / insumo.cantidadPorUnidad);
    }
  }
  producido = Math.max(0, producido);
  return { ...estado, stock: estado.stock + producido, ultimoCalculo: ahoraMs };
}

export interface DatosTransporte {
  duracionViajeSeg: number;
  cargaPorViaje: number;
}

export interface ResultadoTransporte {
  transportado: number;
  nuevoUltimoResuelto: number;
}

/**
 * Cuántas unidades ha movido un contrato de transporte desde
 * `ultimoResuelto` hasta `ahoraMs`, en viajes COMPLETOS (un viaje a medias
 * no entrega nada todavía) — capado por lo que había disponible en origen y
 * hueco libre en destino. El reloj SOLO avanza en múltiplos exactos de
 * `duracionViajeSeg` (nunca se resetea a `ahoraMs`), igual que el patrón ya
 * usado para la expiración de alquileres (docs/GDD_Propiedades.md) — evita
 * "resetear el contador" con solo consultar el estado.
 *
 * Simplificación deliberada v1: si el viaje se capa por falta de stock en
 * origen o hueco en destino, el reloj avanza igualmente por los viajes que
 * el tiempo transcurrido permitía — se trata como "el carro hizo el viaje
 * medio vacío", no como un viaje que nunca ocurrió.
 */
export function resolverTransporte(
  ultimoResuelto: number,
  ahoraMs: number,
  datos: DatosTransporte,
  stockDisponibleOrigen: number,
  huecoDisponibleDestino: number,
): ResultadoTransporte {
  const segundosTranscurridos = Math.max(0, (ahoraMs - ultimoResuelto) / 1000);
  const viajesCompletos = Math.floor(segundosTranscurridos / datos.duracionViajeSeg);
  if (viajesCompletos <= 0) return { transportado: 0, nuevoUltimoResuelto: ultimoResuelto };

  const capacidadPorViajes = viajesCompletos * datos.cargaPorViaje;
  const transportado = Math.max(0, Math.min(capacidadPorViajes, stockDisponibleOrigen, huecoDisponibleDestino));
  const nuevoUltimoResuelto = ultimoResuelto + viajesCompletos * datos.duracionViajeSeg * 1000;
  return { transportado, nuevoUltimoResuelto };
}
